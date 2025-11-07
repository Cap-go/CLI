import { copyFileSync, writeFileSync } from 'node:fs'
import { env, exit } from 'node:process'
import * as esbuild from 'esbuild'

// Build CLI
const buildCLI = esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/index.js',
  sourcemap: env.NODE_ENV === 'development',
  metafile: true,
  minify: true,
  treeShaking: true,
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
    // Stub semver package (used by @capacitor/cli but checkPlatformVersions is never called)
    {
      name: 'stub-semver',
      setup(build) {
        build.onResolve({ filter: /^semver$/ }, args => ({
          path: args.path,
          namespace: 'stub-semver',
        }))
        build.onLoad({ filter: /.*/, namespace: 'stub-semver' }, () => ({
          contents: `
            // Stub for semver package - @capacitor/cli requires it but checkPlatformVersions is never called
            export const diff = () => null;
            export const parse = () => null;
            export const valid = () => null;
            export const clean = () => null;
            export const inc = () => null;
            export const major = () => null;
            export const minor = () => null;
            export const patch = () => null;
            export const compare = () => 0;
            export const rcompare = () => 0;
            export const gt = () => false;
            export const lt = () => false;
            export const eq = () => false;
            export const neq = () => true;
            export const gte = () => false;
            export const lte = () => false;
            export const satisfies = () => false;
            export const maxSatisfying = () => null;
            export const minSatisfying = () => null;
            export const validRange = () => null;
            export const outside = () => false;
            export const gtr = () => false;
            export const ltr = () => false;
            export const intersects = () => false;
            export const coerce = () => null;
            export const Range = class Range {};
            export const SemVer = class SemVer {};
            export const Comparator = class Comparator {};
          `,
        }))
      },
    },
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
    // Stub prompts package (used by @capacitor/cli but not needed in our use case)
    {
      name: 'stub-prompts',
      setup(build) {
        build.onResolve({ filter: /^prompts$/ }, args => ({
          path: args.path,
          namespace: 'stub-prompts',
        }))
        build.onLoad({ filter: /.*/, namespace: 'stub-prompts' }, () => ({
          contents: `
            // Stub for prompts package - @capacitor/cli requires it but we don't use it
            export default function prompts() {
              throw new Error('Prompts are not supported in this CLI build');
            }
          `,
        }))
      },
    },
    // Noop @supabase/auth-js (we don't use auth, just API calls with headers)
    {
      name: 'noop-supabase-auth-js',
      setup(build) {
        build.onResolve({ filter: /@supabase\/auth-js/ }, args => ({
          path: args.path,
          namespace: 'noop-supabase-auth-js',
        }))
        build.onLoad({ filter: /.*/, namespace: 'noop-supabase-auth-js' }, () => ({
          contents: `
            // Stub for @supabase/auth-js - we don't use authentication, just API calls
            const noopAsync = () => Promise.resolve({ data: { session: null, user: null }, error: null });
            const noopHandler = {
              get: (target, prop) => {
                if (prop === 'constructor') return target.constructor;
                if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
                if (typeof prop === 'symbol') return undefined;
                // Return method that returns properly structured promises
                if (prop === 'getSession') return () => Promise.resolve({ data: { session: null, user: null }, error: null });
                if (prop === 'onAuthStateChange') return () => ({ data: { subscription: { unsubscribe: () => {} } }, error: null });
                return noopAsync;
              }
            };

            export class GoTrueClient {
              constructor(options) {
                this.options = options;
                return new Proxy(this, noopHandler);
              }
            }
            export class GoTrueAdminApi {
              constructor(options) {
                this.options = options;
                return new Proxy(this, noopHandler);
              }
            }
            export class AuthClient extends GoTrueClient {}
            export class AuthAdminApi extends GoTrueAdminApi {}

            // Export error classes
            export class AuthError extends Error {}
            export class AuthApiError extends AuthError {}
            export class AuthRetryableError extends AuthError {}
            export class AuthSessionMissingError extends AuthError {}
            export class AuthInvalidTokenResponseError extends AuthError {}
            export class AuthInvalidCredentialsError extends AuthError {}
            export class AuthImplicitGrantRedirectError extends AuthError {}
            export class AuthPKCEGrantCodeExchangeError extends AuthError {}
            export class AuthWeakPasswordError extends AuthError {}

            // Export helper functions
            export const navigatorLock = noopAsync;
            export const processLock = noopAsync;
            export class NavigatorLockAcquireTimeoutError extends Error {}
            export const lockInternals = {};

            // Export type helpers
            export const isAuthError = () => false;
            export const isAuthApiError = () => false;
            export const isAuthRetryableError = () => false;
            export const isAuthSessionMissingError = () => false;
            export const isAuthWeakPasswordError = () => false;
          `,
        }))
      },
    },
  ],
})

// Build SDK (separate bundle without CLI dependencies)
const buildSDK = esbuild.build({
  entryPoints: ['src/sdk.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/src/sdk.js',
  sourcemap: env.NODE_ENV === 'development',
  metafile: true,
  minify: true,
  treeShaking: true,
  format: 'cjs',
  define: {
    'process.env.SUPA_DB': '"production"',
  },
  loader: {
    '.ts': 'ts',
  },
  plugins: [
    // Same plugins as CLI but without banner
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
  ],
})

Promise.all([buildCLI, buildSDK]).catch(() => exit(1)).then((results) => {
  writeFileSync('meta.json', JSON.stringify(results[0].metafile))
  copyFileSync('package.json', 'dist/package.json')
  console.error('✅ Built CLI and SDK successfully')
})
