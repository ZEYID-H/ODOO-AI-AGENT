import type { DefaultSession } from "next-auth";

// Auth.js's base Session type doesn't declare user.id (see auth.ts's
// comment on the callbacks) — this augmentation makes the type match what
// the session callback actually puts there at runtime.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
