import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same origin as the app, so no baseURL: the browser talks to /api/auth on whatever host serves it.
export const authClient = createAuthClient({ plugins: [organizationClient()] });

export const { useSession, signIn, signUp, signOut } = authClient;
