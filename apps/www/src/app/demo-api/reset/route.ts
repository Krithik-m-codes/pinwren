import { allow, clientIp, cookieKey, problem } from "@/lib/demo/http";
import { resetVisitor } from "@/lib/demo/store";

// Throw the visitor's sandbox away; the next widget request seeds a fresh one.
export function POST(req: Request) {
  const key = cookieKey(req);
  if (!key) return problem(401, "NO_DEMO_SESSION", "Open the demo first to start a sandbox");
  if (!allow(`reset:${clientIp(req)}`, 10))
    return problem(429, "RATE_LIMITED", "Too many resets — try again in a minute");
  resetVisitor(key);
  return new Response(null, { status: 204 });
}
