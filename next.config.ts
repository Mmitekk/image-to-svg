import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    ".space-z.ai",
  ],
  serverExternalPackages: ["jimp", "imagetracerjs", "sharp", "png-to-ico"],
};

export default nextConfig;
