export async function register() {
  // Node-only startup work lives in its own module so the Edge build never sees it.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
