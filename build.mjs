import * as esbuild from "esbuild";

// Replace 'your-external-dependencies-here' with actual externals from your project
const external = [];

esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  external,
  outdir: "dist",
  sourcemap: process.env.NODE_ENV === "development",
  banner: {
    js: "#!/usr/bin/env node",
  },
  define: {
    "process.env.SUPA_DB": '"production"',
  },
  loader: {
    ".ts": "ts",
  },
}).catch(() => process.exit(1));
