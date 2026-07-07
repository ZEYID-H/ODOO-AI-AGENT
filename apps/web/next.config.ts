import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't advertise the framework in responses (minor fingerprinting
  // hygiene — no functional effect).
  poweredByHeader: false,

  // Baseline security headers (Phase 9 audit follow-up). Low current
  // exploitability for a personal-use tool that isn't publicly deployed,
  // but standard, cheap hardening with no behavior change for the app
  // itself: X-Frame-Options blocks this app (in particular /login) from
  // being framed by another site (clickjacking); X-Content-Type-Options
  // stops browsers from MIME-sniffing responses into an unintended type;
  // Referrer-Policy avoids leaking full URLs (which could include query
  // params) to third-party destinations.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
