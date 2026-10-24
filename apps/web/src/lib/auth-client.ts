import { passkeyClient } from "@better-auth/passkey/client";
import { magicLinkClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same origin as the app, so no baseURL: the browser talks to /api/auth on whatever host serves it.
// Two-factor: sign-in answers `twoFactorRedirect` and the sign-in form asks for the code itself.
// Email links, passkeys and Google / GitHub are offered only when the server says so (`GET /api/sign-in-methods`).
export const authClient = createAuthClient({
  plugins: [organizationClient(), twoFactorClient(), magicLinkClient(), passkeyClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;
