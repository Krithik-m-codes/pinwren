// Runs the Next.js standalone server on several CPU cores. One Node process uses one core; the load
// test showed the app saturating it at ~75 req/s. Workers share the port through node:cluster.
// ANNOTA_WORKERS=1 runs a single process (no cluster).
const cluster = require("node:cluster");

const workers = Math.max(1, Number(process.env.ANNOTA_WORKERS || 2));
const server = process.env.ANNOTA_SERVER_ENTRY || "/app/apps/web/server.js";

if (workers === 1 || !cluster.isPrimary) {
  require(server);
} else {
  let stopping = false;
  console.log(`[annota] starting ${workers} workers`);
  for (let i = 0; i < workers; i++) cluster.fork();
  cluster.on("exit", (worker, code, signal) => {
    if (stopping) return;
    console.error(`[annota] worker ${worker.process.pid} exited (${signal || code}); restarting`);
    cluster.fork();
  });
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => {
      stopping = true;
      for (const w of Object.values(cluster.workers)) w?.kill(sig);
      setTimeout(() => process.exit(0), 10_000).unref();
      cluster.on("exit", () => {
        if (Object.keys(cluster.workers).length === 0) process.exit(0);
      });
    });
  }
}
