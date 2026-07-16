import type { NextConfig } from "next";

const config: NextConfig = {
  // The repo root has its own package-lock.json (the worker); keep Next's
  // file tracing scoped to the installer app.
  outputFileTracingRoot: __dirname,
};

export default config;
