import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't advertise the framework in responses (minor fingerprinting
  // hygiene — no functional effect).
  poweredByHeader: false,

  // Delivery D3: Server Actions default to a 1MB request body, far below a
  // phone photo. 12mb gives headroom over the app's own hard 10MB image cap
  // (lib/file-storage.ts MAX_UPLOAD_BYTES) plus the multipart envelope —
  // the app-level cap stays the real limit; this only stops Next from
  // rejecting the request before our validation ever sees it.
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },

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
