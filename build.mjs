import { exit } from 'node:process'
import * as esbuild from 'esbuild'

esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'dist/index.js', // Change this to output a single file
  sourcemap: process.env.NODE_ENV === 'development',
  minify: true, // Minify the output
  treeShaking: true, // Enable tree shaking to remove unused code
  banner: {
    js: '#!/usr/bin/env node',
  },
  define: {
    'process.env.SUPA_DB': '"production"',
  },
  loader: {
    '.ts': 'ts',
  },
}).catch(() => exit(1))
