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
 *
 * Note (Phase 9 audit): brute-force protection (attemptLogin, in
 * lib/auth-credentials.ts) is called directly from authorize() — not from
 * app/actions/auth.ts's loginAction — because Auth.js auto-mounts a raw
 * `/api/auth/callback/credentials` route (via the catch-all handler in
 * app/api/auth/[...nextauth]/route.ts) that calls authorize() directly,
 * bypassing the login form/Server Action entirely; confirmed by actually
 * POSTing to it repeatedly against the running Docker container and
 * watching it keep accepting attempts with zero involvement from
 * loginAction. authorize() is the one true chokepoint both paths funnel
 * through.
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { attemptLogin } from "@/lib/auth-credentials";

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
        return attemptLogin(credentials?.password);
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
