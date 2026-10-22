import { setupClaim } from "@pinwren/core";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getAuth } from "../auth";
import { ApiError, unauthorized } from "../errors";
import { clientIp } from "../net";
import { consume } from "../rate-limit";
import { claimSetup, setupNeeded } from "../services/setup";

/** Claim attempts per address and hour; the token is 256 random bits, this only keeps logs quiet. */
const CLAIMS_PER_HOUR = 10;

/**
 * First-run setup (ADR 0021): whoever holds the token printed to the server log becomes the instance
 * admin. Needs a signed-in account but no organisation yet, so it sits outside the dashboard routes.
 */
export const setup = new Hono()
  .get("/setup", async (c) => c.json({ needed: await setupNeeded() }))

  .post("/setup/claim", zValidator("json", setupClaim), async (c) => {
    if (!(await consume(`setup:${clientIp(c)}`, CLAIMS_PER_HOUR, 3600))) {
      throw new ApiError(429, "RATE_LIMITED", "Too many attempts — try again later");
    }
    const session = await getAuth().api.getSession({ headers: c.req.raw.headers });
    if (!session) throw unauthorized();
    const result = await claimSetup(session.user.id, c.req.valid("json").token);
    if (result === "not_needed") {
      throw new ApiError(409, "SETUP_DONE", "This instance already has an administrator");
    }
    if (result === "invalid") {
      throw new ApiError(
        403,
        "INVALID_SETUP_TOKEN",
        "That setup token is not valid — copy it from the server log",
      );
    }
    return c.json({ instanceAdmin: true });
  });
