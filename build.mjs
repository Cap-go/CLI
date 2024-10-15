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
    // Generic noop for fetch-related files
    {
      name: 'noop-supabase-node-fetch',
      setup(build) {
        build.onResolve({ filter: /@supabase\/node-fetch/ }, args => ({
          path: args.path,
          namespace: 'noop',
        }))
        build.onLoad({ filter: /.*/, namespace: 'noop' }, () => ({
          contents: 'export default {}',
        }))
      },
    },
    // Noop xml2js as we only use capacitor-cli to read capacitor file nothing native
    {
      name: 'noop-xml2js',
      setup(build) {
        build.onResolve({ filter: /^xml2js$/ }, args => ({
          path: args.path,
          namespace: 'noop',
        }))
        build.onLoad({ filter: /.*/, namespace: 'noop' }, () => ({
          contents: 'export default {}',
        }))
      },
    },
    // Noop @ionic/utils-subprocess
    {
      name: 'noop-ionic-utils-subprocess',
      setup(build) {
        build.onResolve({ filter: /@ionic\/utils-subprocess/ }, args => ({
          path: args.path,
          namespace: 'noop',
        }))
        build.onLoad({ filter: /.*/, namespace: 'noop' }, () => ({
          contents: 'export default {}',
        }))
      },
    },
    // Smarter noop for @ionic/cli-framework-output
    {
      name: 'smart-noop-ionic-cli-framework-output',
      setup(build) {
        build.onResolve({ filter: /@ionic\/cli-framework-output/ }, args => ({
          path: args.path,
          namespace: 'smart-noop-ionic-cli-framework-output',
        }))
        build.onLoad({ filter: /.*/, namespace: 'smart-noop-ionic-cli-framework-output' }, () => ({
          contents: `
            export const TTY_WIDTH = 80;
            export const indent = (str) => str;
            export const sliceAnsi = (str) => str;
            export const stringWidth = (str) => str.length;
            export const stripAnsi = (str) => str;
            export const wordWrap = (str) => str;
            export const createDefaultLogger = () => ({
              info: console.log,
              warn: console.warn,
              error: console.error,
              debug: console.debug,
            });
            export const NO_COLORS = {};
            export class StreamOutputStrategy {
              constructor() {
                this.colors = NO_COLORS;
                this.stream = process.stdout;
              }
            }
            export class TTYOutputStrategy extends StreamOutputStrategy {
              constructor(options) {
                super();
                this.options = options;
              }
            }
            export class Logger {
              constructor() {}
              info() {}
              warn() {}
              error() {}
              debug() {}
            }
            export const LOGGER_LEVELS = {
              DEBUG: 'DEBUG',
              INFO: 'INFO',
              WARN: 'WARN',
              ERROR: 'ERROR'
            };
          `,
        }))
      },
    },
    // Noop @supabase/realtime-js
    {
      name: 'noop-supabase-realtime-js',
      setup(build) {
        build.onResolve({ filter: /@supabase\/realtime-js/ }, args => ({
          path: args.path,
          namespace: 'noop-supabase-realtime-js',
        }))
        build.onLoad({ filter: /.*/, namespace: 'noop-supabase-realtime-js' }, () => ({
          contents: `
            export class RealtimeClient {
              constructor() {}
              connect() {}
              disconnect() {}
            }
          `,
        }))
      },
    },
  ],
}).catch(() => exit(1)).then((result) => {
  writeFileSync('meta.json', JSON.stringify(result.metafile))
})
