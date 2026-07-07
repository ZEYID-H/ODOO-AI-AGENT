/**
 * Auth.js (NextAuth v5) configuration.
 *
 * No database/adapter is configured, so Auth.js defaults to JWT session
 * strategy: session state lives only in a signed, http-only cookie — never
 * in localStorage, never readable by client-side JavaScript. This matches
 * the "minimal credentials-based provider" fallback explicitly pre-approved
 * for this phase (a database is not required).
 *
 * Extending later: add more `providers` (OAuth, etc.), add a `database`
 * adapter for real user accounts, or enrich the `jwt`/`session` callbacks
 * with role/organization/tenant fields — none of that requires touching
 * the /dashboard guard (lib/session-guard.ts) or the login form.
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyAppPassword } from "@/lib/auth-credentials";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "Personal Access",
      credentials: {
        password: { label: "Password", type: "password" },
      },
      authorize(credentials) {
        const user = verifyAppPassword(credentials?.password);
        return user;
      },
    }),
  ],
});
