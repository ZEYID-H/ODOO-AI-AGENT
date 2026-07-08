import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/auth-credentials";

// Auth.js's base types declare neither user.id nor a role (see auth.ts's
// comment on the callbacks) — these augmentations make the types match what
// the callbacks actually put there at runtime.
//
// `role` is optional on Session.user deliberately: a session cookie minted
// before D1 carries no role claim, so typing it as always-present would
// hide exactly the case requireRole() has to handle (it fails closed to
// /login). The `User` augmentation types what authorize() returns.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role?: Role;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role;
  }
}
