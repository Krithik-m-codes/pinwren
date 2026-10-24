import type { authClient as AuthClient } from "@/lib/auth-client";
import { type ApiError, baseApi } from "./base";

// Sign-in methods (wave 5): what the auth pages offer, the instance switches in Settings › Security, and
// the signed-in person's passkeys and connected Google / GitHub accounts (Settings › Profile). Injected on
// its own; import the hooks from here.

export type OAuthProvider = "google" | "github";

/** `GET /api/sign-in-methods`: public. */
export type SignInMethods = {
  password: true;
  magicLink: boolean;
  passkey: boolean;
  google: boolean;
  github: boolean;
};

/** `GET /api/admin/settings/sign-in`: instance admins. */
export type SignInSettings = {
  magicLink: boolean;
  passkeys: boolean;
  emailConfigured: boolean;
  providers: {
    id: OAuthProvider;
    name: string;
    configured: boolean;
    callbackUrl: string;
    envVars: [string, string];
  }[];
};

/** A sign-in method linked to the account (Better Auth `listAccounts`): `credential` is the password. */
export type LinkedAccount = {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: string;
};

/** A registered passkey (`passkey.listUserPasskeys`). */
export type Passkey = {
  id: string;
  name?: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt?: string | null;
  aaguid?: string | null;
};

type AuthResult<T> = { data: T | null; error: { message?: string | undefined; status?: number } | null };

/** A Better Auth client call as an RTK Query result (imported lazily: the store also runs outside a browser). */
async function auth<T>(call: (client: typeof AuthClient) => Promise<AuthResult<T>>) {
  const { authClient } = await import("@/lib/auth-client");
  const res = await call(authClient);
  if (res.error || res.data === null) {
    const error: ApiError = {
      status: res.error?.status ?? 400,
      code: "AUTH_ERROR",
      message: res.error?.message ?? "Request failed",
    };
    return { error };
  }
  return { data: JSON.parse(JSON.stringify(res.data)) as T };
}

const LINKED = { type: "Me", id: "LINKED_ACCOUNTS" } as const;
const PASSKEYS = { type: "Me", id: "PASSKEYS" } as const;
const SIGN_IN = { type: "Security", id: "SIGN_IN" } as const;

export const signInApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    signInMethods: build.query<SignInMethods, undefined>({
      query: () => "/sign-in-methods",
      transformResponse: (r: { methods: SignInMethods }) => r.methods,
      keepUnusedDataFor: 30,
      providesTags: [SIGN_IN],
    }),

    signInSettings: build.query<{ signIn: SignInSettings }, undefined>({
      query: () => "/admin/settings/sign-in",
      providesTags: [SIGN_IN],
    }),
    updateSignInSettings: build.mutation<
      { signIn: SignInSettings },
      Partial<Pick<SignInSettings, "magicLink" | "passkeys">>
    >({
      query: (body) => ({ url: "/admin/settings/sign-in", method: "PATCH", body }),
      async onQueryStarted(_patch, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          void dispatch(signInApi.util.upsertQueryData("signInSettings", undefined, data));
        } catch {
          // the caller's unwrap() shows the error
        }
      },
      invalidatesTags: [SIGN_IN],
    }),

    linkedAccounts: build.query<LinkedAccount[], undefined>({
      queryFn: () => auth((c) => c.listAccounts() as Promise<AuthResult<LinkedAccount[]>>),
      providesTags: [LINKED],
    }),
    unlinkAccount: build.mutation<unknown, { providerId: string; accountId: string }>({
      queryFn: (body) => auth((c) => c.unlinkAccount(body) as Promise<AuthResult<unknown>>),
      invalidatesTags: [LINKED],
    }),

    passkeys: build.query<Passkey[], undefined>({
      queryFn: () => auth((c) => c.passkey.listUserPasskeys() as Promise<AuthResult<Passkey[]>>),
      providesTags: [PASSKEYS],
    }),
    renamePasskey: build.mutation<unknown, { id: string; name: string }>({
      queryFn: (body) => auth((c) => c.passkey.updatePasskey(body) as Promise<AuthResult<unknown>>),
      invalidatesTags: [PASSKEYS],
    }),
    deletePasskey: build.mutation<unknown, string>({
      queryFn: (id) => auth((c) => c.passkey.deletePasskey({ id }) as Promise<AuthResult<unknown>>),
      invalidatesTags: [PASSKEYS],
    }),
  }),
});

/** Registering a passkey runs the browser ceremony, so it isn't an RTK mutation; refresh the list after. */
export const passkeysChanged = () => signInApi.util.invalidateTags([PASSKEYS]);

export const {
  useSignInMethodsQuery,
  useSignInSettingsQuery,
  useUpdateSignInSettingsMutation,
  useLinkedAccountsQuery,
  useUnlinkAccountMutation,
  usePasskeysQuery,
  useRenamePasskeyMutation,
  useDeletePasskeyMutation,
} = signInApi;
