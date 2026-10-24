import { APP_ROLES, MIN_PASSWORD_LENGTH, memberCreate } from "@pinwren/core";
import { z } from "zod";

// Form schemas of the account screens (sign-in steps, Users, Profile, Workspace). Built from the API's own
// schemas in @pinwren/core where one exists (Add User), so a form refuses exactly what the server would.

const email = z.email("Enter a valid email address").max(254);
const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(128, "Use at most 128 characters");

export const forgotPasswordForm = z.object({ email });

export const resetPasswordForm = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords don't match" });

/** An authenticator code (6 digits, spaces allowed) or a backup code. */
export const twoFactorCodeForm = z.object({
  code: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, ""))
    .pipe(z.string().min(6, "Enter the code").max(32)),
  trustDevice: z.boolean(),
});

/** Users › Add User: the API's `memberCreate`. */
export const addUserForm = memberCreate;

export const inviteUserForm = z.object({ email, role: z.enum(APP_ROLES) });

export const changeEmailForm = z.object({ newEmail: email, password: z.string() });

export const passwordConfirmForm = z.object({ password: z.string().min(1, "Enter your password") });

export const workspaceNameForm = z.object({
  name: z.string().trim().min(1, "Name the workspace").max(80),
});
