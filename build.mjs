import { writeFileSync } from 'node:fs'
import { exit } from 'node:process'
import * as esbuild from 'esbuild'

esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/index.js', // Change this to output a single file
  sourcemap: process.env.NODE_ENV === 'development',
  metafile: true,
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
  plugins: [
    // TOSO: remove this when fixed
    {
      name: 'ignore-punycode',
      setup(build) {
        build.onResolve({ filter: /^punycode$/ }, args => ({
          path: args.path,
          namespace: 'ignore',
        }))
        build.onLoad({ filter: /.*/, namespace: 'ignore' }, () => ({
          contents: 'export default {}',
        }))
      },
    },
  ],
}).catch(() => exit(1)).then((result) => {
  writeFileSync('meta.json', JSON.stringify(result.metafile))
})
