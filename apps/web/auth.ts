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
 *
 * Note (Phase 8F): Auth.js's *default* `session` callback deliberately
 * strips everything except name/email/image — `user.id` does NOT reach
 * `session.user.id` without an explicit callback, even though the JWT's
 * internal `sub` claim already holds it. Conversation ownership (Phase 8F)
 * needs a stable user id, so both callbacks below are required, not
 * optional polish.
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
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
