import type { NextConfig } from "next";

// `next dev` refuses its hot-reload socket to any host other than localhost,
// and a page opened through the tunnel then never becomes interactive. Allow
// the host the app is actually served from.
function appHost(): string[] {
  try {
    const { hostname } = new URL(process.env.APP_URL ?? "");
    return hostname === "localhost" ? [] : [hostname];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  allowedDevOrigins: appHost(),
};

export default nextConfig;
