import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { framesSchema, httpResultSchema, replySchema, type InstanceCommand } from "./multi-instance-protocol";

const require = createRequire(new URL("../../../db/package.json", import.meta.url));

/** Actual separate Node instances; no production transports or authorization are mocked. */
export class CloudInstance {
  readonly child: ChildProcess;
  readonly ready: Promise<number>;
  private diagnostics = "";
  private readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    runtimeUrl: string,
    serviceUrl: string,
    secret: string,
    readonly name: string,
  ) {
    const named = (url: string) => {
      const parsed = new URL(url);
      parsed.searchParams.set("application_name", name);
      return parsed.toString();
    };
    this.child = fork(fileURLToPath(new URL("./multi-instance-worker.ts", import.meta.url)), [], {
      execArgv: ["--import", pathToFileURL(require.resolve("tsx")).href],
      env: {
        ...process.env,
        PINWREN_TEST_MULTIPROCESS: "1",
        PINWREN_MODE: "cloud",
        DATABASE_URL: named(runtimeUrl),
        PINWREN_SERVICE_DATABASE_URL: named(serviceUrl),
        PINWREN_URL: "http://localhost:3100",
        PINWREN_SECRET: secret,
        DATABASE_POOL_MAX: "1",
        PINWREN_ADMIN_EMAILS: "",
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const capture = (chunk: Buffer) => {
      this.diagnostics = (this.diagnostics + chunk.toString()).slice(-12000);
    };
    this.child.stdout?.on("data", capture);
    this.child.stderr?.on("data", capture);
    this.ready = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.child.kill("SIGKILL");
        reject(new Error(`Instance startup timed out: ${this.diagnostics}`));
      }, 30_000);
      this.child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      this.child.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error(`Instance exited: ${this.diagnostics}`));
      });
      this.child.on("message", (message: unknown) => {
        const parsed = replySchema.safeParse(message);
        if (!parsed.success) return;
        if (parsed.data.kind === "ready") {
          clearTimeout(timeout);
          resolve(parsed.data.pid);
          return;
        }
        const reply = parsed.data,
          pending = this.pending.get(reply.id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(reply.id);
        if (reply.ok) pending.resolve(reply.value);
        else pending.reject(new Error(reply.error ?? "Instance command failed"));
      });
    });
    this.child.on("exit", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`Instance exited: ${this.diagnostics}`));
      }
      this.pending.clear();
    });
  }

  async call(command: InstanceCommand): Promise<unknown> {
    await this.ready;
    if (!this.child.connected) throw new Error("Instance IPC channel is closed");
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Instance command timed out: ${command.op}\n${this.diagnostics}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.child.send({ id, command }, (error) => {
        if (!error) return;
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async request(path: string, cookie?: string, body?: unknown) {
    return httpResultSchema.parse(
      await this.call({
        op: "request",
        path,
        method: body === undefined ? "GET" : "POST",
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { body }),
      }),
    );
  }
  async open(name: string, path: string, cookie: string, lastEventId?: string) {
    return httpResultSchema.parse(
      await this.call({ op: "open", name, path, cookie, ...(lastEventId ? { lastEventId } : {}) }),
    );
  }
  async events(name: string) {
    return framesSchema.parse(await this.call({ op: "events", name }));
  }
  async close() {
    if (!this.child.pid || this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.child.kill("SIGKILL");
        reject(new Error("Instance did not exit within the cleanup deadline"));
      }, 10_000);
      this.child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.child.kill();
    });
  }
}
