import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  experimental: { cpus: 2 },
  serverExternalPackages: ["pg", "pg-boss"],
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      // Native form POSTs need their real Origin for the CSRF check. Sensitive
      // authorization redirects/callbacks explicitly override this policy.
      { key: "Referrer-Policy", value: "strict-origin" },
      { key: "X-Frame-Options", value: "DENY" },
    ] }, {
      // Configured headers can override handler headers, so keep the sensitive
      // route policy explicit here as well as in the redirect handlers.
      source: "/api/integrations/shopee/:path*",
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    }, {
      source: "/api/auth/:path*",
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    }];
  },
};

export default config;
