"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prevState: LoginState | undefined,
  formData: FormData
): Promise<LoginState> {
  try {
    await signIn("credentials", {
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
    return {};
  } catch (error) {
    // signIn() throws Next's redirect signal on success — only AuthError
    // (wrong/missing password) should be turned into a form error; anything
    // else (including the redirect) must be rethrown, never swallowed.
    if (error instanceof AuthError) {
      return { error: "Invalid password. Please try again." };
    }
    throw error;
  }
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
