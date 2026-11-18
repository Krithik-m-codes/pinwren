import { randomUUID } from "node:crypto";
import { app } from "../index";
import { consume, consumeAmount, exhausted } from "../rate-limit";
import { publish, type BusEvent } from "../realtime/bus";
import {
  type commandSchema,
  envelopeSchema,
  frameSchema,
  type InstanceFrame,
} from "./multi-instance-protocol";
import type { z } from "zod";

const send = process.send?.bind(process);
if (!send || process.env.PINWREN_TEST_MULTIPROCESS !== "1")
  throw new Error("This entry point requires test IPC");
type Stream = {
  controller: AbortController;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  pump: Promise<void>;
  frames: InstanceFrame[];
  failure: Error | null;
  ended: boolean;
  closing: boolean;
};
const streams = new Map<string, Stream>();

async function request(
  path: string,
  method: string,
  cookie?: string,
  body?: unknown,
  signal?: AbortSignal,
  lastEventId?: string,
) {
  const headers = new Headers({ origin: "http://localhost:3100", "content-type": "application/json" });
  if (cookie) headers.set("cookie", cookie);
  if (lastEventId) headers.set("last-event-id", lastEventId);
  return app.request(`http://localhost:3100${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
}

async function execute(command: z.output<typeof commandSchema>): Promise<unknown> {
  switch (command.op) {
    case "request": {
      const response = await request(command.path, command.method, command.cookie, command.body);
      const text = await response.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* Non-JSON errors remain observable. */
      }
      return { status: response.status, body, cookies: response.headers.getSetCookie() };
    }
    case "open": {
      if (streams.has(command.name)) throw new Error("Stream name is already in use");
      const controller = new AbortController();
      const response = await request(
        command.path,
        "GET",
        command.cookie,
        undefined,
        controller.signal,
        command.lastEventId,
      );
      if (response.status !== 200 || !response.body)
        return { status: response.status, body: await response.text(), cookies: [] };
      const reader = response.body.getReader();
      const frames: InstanceFrame[] = [];
      let resolveReady: () => void = () => undefined;
      let rejectReady: (error: unknown) => void = () => undefined;
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      const stream: Stream = {
        controller,
        reader,
        pump: Promise.resolve(),
        frames,
        failure: null,
        ended: false,
        closing: false,
      };
      stream.pump = (async () => {
        const decoder = new TextDecoder();
        let buffer = "",
          live = false;
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            const lines = buffer.slice(0, boundary).split("\n");
            buffer = buffer.slice(boundary + 2);
            const data = lines
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            const event =
              lines
                .find((line) => line.startsWith("event:"))
                ?.slice(6)
                .trim() ?? "message";
            frames.push(
              frameSchema.parse({
                id:
                  lines
                    .find((line) => line.startsWith("id:"))
                    ?.slice(3)
                    .trim() ?? null,
                event,
                data: JSON.parse(data) as unknown,
              }),
            );
            if (event === "ping") {
              live = true;
              resolveReady();
            }
          }
        }
        if (!live) throw new Error("Stream ended before its ready ping");
      })()
        .catch((error: unknown) => {
          if (!stream.closing) stream.failure = error instanceof Error ? error : new Error(String(error));
          rejectReady(error);
        })
        .finally(() => {
          stream.ended = true;
        });
      streams.set(command.name, stream);
      await ready;
      return { status: 200, body: null, cookies: [] };
    }
    case "events": {
      const stream = streams.get(command.name);
      if (!stream) throw new Error("Unknown stream");
      if (stream.failure) throw stream.failure;
      if (stream.ended && !stream.closing) throw new Error("Stream ended unexpectedly");
      return stream.frames;
    }
    case "close": {
      const stream = streams.get(command.name);
      if (stream) {
        stream.closing = true;
        stream.controller.abort();
        await stream.reader.cancel().catch(() => undefined);
        await stream.pump;
        streams.delete(command.name);
      }
      return null;
    }
    case "event": {
      const event: BusEvent = {
        t: "e",
        orgId: command.orgId,
        projectId: command.projectId,
        event: "feedback.updated",
        data: { id: command.feedbackId, projectId: command.projectId, changes: {}, marker: command.marker },
      };
      await publish(event);
      return event.id;
    }
    case "bell": {
      await publish({
        t: "n",
        orgId: command.orgId,
        userId: command.userId,
        data: {
          id: randomUUID(),
          orgId: command.orgId,
          feedbackId: null,
          type: "test",
          data: { marker: command.marker },
          createdAt: new Date().toISOString(),
        },
      });
      return null;
    }
    case "rate": {
      if (command.kind === "exhausted") return exhausted(command.key, command.limit);
      if (command.kind === "amount")
        return consumeAmount(command.key, command.amount, command.limit, command.window);
      return consume(command.key, command.limit, command.window);
    }
  }
}

process.on("message", (message: unknown) => {
  const parsed = envelopeSchema.safeParse(message);
  if (!parsed.success) return;
  const { id, command } = parsed.data;
  void execute(command).then(
    (value) => send({ kind: "result", id, ok: true, value }),
    (error: unknown) =>
      send({ kind: "result", id, ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
});
process.on("disconnect", () => process.exit(0));
send({ kind: "ready", pid: process.pid });
