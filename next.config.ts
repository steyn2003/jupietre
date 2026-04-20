import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build a self-contained server bundle for Docker — slim runtime image.
  output: "standalone",
  // The Claude Agent SDK uses Node-only APIs; keep it external so Turbopack
  // doesn't try to trace it into the server bundle.
  serverExternalPackages: [
    "@anthropic-ai/claude-agent-sdk",
    "@anthropic-ai/claude-code",
  ],
};

export default nextConfig;
