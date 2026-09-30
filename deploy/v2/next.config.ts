// Written over sites-secure/next.config.ts at build time by adapt.mjs. The
// app's own options (moved to next.config.sites.ts) are kept and extended
// with a standalone Node server for the container.
import type { NextConfig } from "next";
import sites from "./next.config.sites";

const nextConfig: NextConfig = {
  ...sites,
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
