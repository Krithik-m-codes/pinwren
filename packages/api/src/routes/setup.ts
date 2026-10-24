import { Hono } from "hono";
import { resolveSmtp } from "../email/config";
import { env } from "../env";
import { ApiError } from "../errors";
import { hasAnyUser, signupOpen } from "../services/setup";

/**
 * Public first-run state for the sign-in screens (ADR 0021, amended: the BugPin model). No session.
 * `needed`: no account exists yet, so the visitor creates the administrator account. `signupOpen`: a
 * stranger may create an account (the "Create an account" link). `emailConfigured`: whether "Forgot
 * password?" can send anything. `appUrl`: PINWREN_URL's origin, so a page opened on another address can
 * say where the server expects to be reached.
 */
export const setup = new Hono()
  .get("/setup", async (c) => {
    const [anyone, open, smtp] = await Promise.all([hasAnyUser(), signupOpen(), resolveSmtp()]);
    c.header("cache-control", "no-store");
    return c.json({
      needed: !anyone,
      signupOpen: open,
      emailConfigured: smtp !== null,
      appUrl: new URL(env().PINWREN_URL).origin,
    });
  })

  // The setup-token claim is gone: the first account is the administrator. Old links get a clear answer.
  .post("/setup/claim", () => {
    throw new ApiError(
      410,
      "SETUP_TOKEN_REMOVED",
      "Setup tokens are gone: the first account on an instance is its administrator",
    );
  });
