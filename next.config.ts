import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Claude Agent SDK uses Node-only APIs; keep it off the edge runtime.
  serverExternalPackages: [
    "@anthropic-ai/claude-agent-sdk",
    "@anthropic-ai/claude-code",
  ],
  webpack: (config, { nextRuntime, webpack }) => {
    // `instrumentation.ts` is bundled for BOTH the nodejs and edge runtimes.
    // The poller/runner chain uses node:child_process and other Node-only
    // APIs. Its execution is already gated by `NEXT_RUNTIME === "nodejs"`,
    // so exclude the whole chain from the edge bundle to avoid tracing it.
    if (nextRuntime === "edge") {
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp:
            /[\\/]lib[\\/](linear[\\/]poller|agent[\\/](runner|roles)|auth[\\/]bootstrap)/,
        }),
      );
    }
    return config;
  },
};

export default nextConfig;
