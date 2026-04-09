#!/usr/bin/env node
/**
 * remove-encryption-key.mjs
 *
 * TEST-ONLY helper for iterating on the `capgo init` encryption step.
 * Wipes RSA encryption artefacts so the next `capgo init` / `capgo key create`
 * run starts from a clean slate:
 *
 *   1. Deletes the key files from the target dir if they exist:
 *        .capgo_key, .capgo_key_v2, .capgo_key.pub, .capgo_key_v2.pub
 *   2. Scrubs `publicKey` / `privateKey` from `plugins.CapacitorUpdater` in
 *      `capacitor.config.json` (if present).
 *   3. Scrubs `publicKey:` / `privateKey:` lines from `capacitor.config.ts`
 *      and `capacitor.config.js` via a regex that handles single-line and
 *      multi-line string literals (including template strings with embedded
 *      PEM). It is deliberately line-scoped so it will not touch unrelated
 *      code referencing the same identifier.
 *
 * NOT shipped as a CLI subcommand on purpose — only useful when manually
 * QA'ing the wizard, never for end users.
 *
 * Usage:
 *   node scripts/remove-encryption-key.mjs            # wipe in cwd
 *   node scripts/remove-encryption-key.mjs ../my-app  # wipe in another dir
 *   node scripts/remove-encryption-key.mjs --show     # only prints current state
 *   node scripts/remove-encryption-key.mjs --dry-run  # preview without writing
 */

import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { argv, cwd, exit } from 'node:process'

const KEY_FILES = [
  '.capgo_key',
  '.capgo_key_v2',
  '.capgo_key.pub',
  '.capgo_key_v2.pub',
]

const TS_CONFIG_FILES = ['capacitor.config.ts', 'capacitor.config.js']
const JSON_CONFIG_FILE = 'capacitor.config.json'

function listKeyFiles(targetDir) {
  return KEY_FILES
    .map(name => join(targetDir, name))
    .filter(path => existsSync(path))
}

function readJsonConfig(targetDir) {
  const path = join(targetDir, JSON_CONFIG_FILE)
  if (!existsSync(path))
    return undefined
  try {
    const raw = readFileSync(path, 'utf8')
    return { path, parsed: JSON.parse(raw), raw }
  }
  catch (err) {
    console.error(`❌ Cannot parse ${path}: ${err.message}`)
    exit(1)
  }
}

function findTsConfigs(targetDir) {
  return TS_CONFIG_FILES
    .map(name => join(targetDir, name))
    .filter(path => existsSync(path))
}

function scrubJsonConfig(parsed) {
  const updater = parsed?.plugins?.CapacitorUpdater
  if (!updater || typeof updater !== 'object')
    return { next: parsed, removed: [] }

  const removed = []
  const nextUpdater = { ...updater }
  if ('publicKey' in nextUpdater) {
    removed.push('publicKey')
    delete nextUpdater.publicKey
  }
  if ('privateKey' in nextUpdater) {
    removed.push('privateKey')
    delete nextUpdater.privateKey
  }
  if (removed.length === 0)
    return { next: parsed, removed }

  return {
    next: {
      ...parsed,
      plugins: {
        ...parsed.plugins,
        CapacitorUpdater: nextUpdater,
      },
    },
    removed,
  }
}

// Matches a full line (plus its trailing newline) shaped like:
//   publicKey: '...anything including escaped quotes...',
//   privateKey: "...",
//   publicKey: `multi
//   line template`,
// The value quote is captured and reused to find the closing quote, and
// [\s\S] lets the string literal span multiple lines (for template strings
// holding an inlined PEM).
const TS_KEY_RE = /^[ \t]*(?:publicKey|privateKey)\s*:\s*(['"`])(?:\\.|(?!\1)[\s\S])*?\1\s*,?[ \t]*\r?\n/gm

function readTsConfig(path) {
  try {
    return readFileSync(path, 'utf8')
  }
  catch {
    return undefined
  }
}

function scrubTsConfig(raw) {
  const removed = []
  const next = raw.replace(TS_KEY_RE, (match) => {
    const field = /publicKey/.test(match) ? 'publicKey' : 'privateKey'
    removed.push(field)
    return ''
  })
  return { next, removed }
}

function main() {
  const args = argv.slice(2)
  const show = args.includes('--show')
  const dryRun = args.includes('--dry-run')
  const positional = args.filter(a => !a.startsWith('--'))
  const targetDir = resolve(positional[0] ?? cwd())

  let stat
  try {
    stat = statSync(targetDir)
  }
  catch {
    console.error(`❌ Target directory does not exist: ${targetDir}`)
    exit(1)
  }
  if (!stat.isDirectory()) {
    console.error(`❌ Target is not a directory: ${targetDir}`)
    exit(1)
  }

  const keyFiles = listKeyFiles(targetDir)
  const jsonConfig = readJsonConfig(targetDir)
  const tsConfigs = findTsConfigs(targetDir)
  const jsonScrub = jsonConfig
    ? scrubJsonConfig(jsonConfig.parsed)
    : { next: undefined, removed: [] }
  const tsScrubs = tsConfigs
    .map((path) => {
      const raw = readTsConfig(path)
      if (raw === undefined)
        return undefined
      const { next, removed } = scrubTsConfig(raw)
      return { path, raw, next, removed }
    })
    .filter(entry => entry !== undefined)
  const tsScrubsWithRemovals = tsScrubs.filter(entry => entry.removed.length > 0)

  if (show) {
    console.log(`📄 ${targetDir}`)
    console.log(`   key files on disk: ${keyFiles.length === 0 ? 'none' : ''}`)
    for (const file of keyFiles)
      console.log(`     • ${relative(targetDir, file)}`)
    if (jsonConfig) {
      console.log(`   ${JSON_CONFIG_FILE}: ${jsonScrub.removed.length === 0 ? 'clean' : `has ${jsonScrub.removed.join(', ')}`}`)
    }
    else {
      console.log(`   ${JSON_CONFIG_FILE}: absent`)
    }
    for (const entry of tsScrubs) {
      console.log(
        `   ${relative(targetDir, entry.path)}: ${
          entry.removed.length === 0
            ? 'clean'
            : `has ${entry.removed.join(', ')}`
        }`,
      )
    }
    return
  }

  const nothingToDo
    = keyFiles.length === 0
    && jsonScrub.removed.length === 0
    && tsScrubsWithRemovals.length === 0

  if (nothingToDo) {
    console.log(`ℹ️  Nothing to clean in ${targetDir}`)
    return
  }

  console.log(`${dryRun ? '🔎 Dry run — ' : '🧹 '}Cleaning ${targetDir}`)

  for (const file of keyFiles) {
    if (!dryRun)
      rmSync(file)
    console.log(`  ${dryRun ? 'would delete' : 'deleted'} ${relative(targetDir, file)}`)
  }

  if (jsonConfig && jsonScrub.removed.length > 0) {
    if (!dryRun) {
      // Preserve trailing newline if the original had one.
      const trailing = jsonConfig.raw.endsWith('\n') ? '\n' : ''
      writeFileSync(
        jsonConfig.path,
        `${JSON.stringify(jsonScrub.next, null, 2)}${trailing}`,
        'utf8',
      )
    }
    console.log(
      `  ${dryRun ? 'would scrub' : 'scrubbed'} ${relative(targetDir, jsonConfig.path)}`
      + ` (${jsonScrub.removed.join(', ')})`,
    )
  }

  for (const entry of tsScrubsWithRemovals) {
    if (!dryRun)
      writeFileSync(entry.path, entry.next, 'utf8')
    console.log(
      `  ${dryRun ? 'would scrub' : 'scrubbed'} ${relative(targetDir, entry.path)}`
      + ` (${entry.removed.join(', ')})`,
    )
  }

  const totalTsRemoved = tsScrubsWithRemovals.reduce(
    (sum, entry) => sum + entry.removed.length,
    0,
  )

  console.log('')
  console.log(`✅ ${dryRun ? 'Would remove' : 'Removed'} ${keyFiles.length} key file(s)`)
  if (jsonConfig)
    console.log(`   ${JSON_CONFIG_FILE} entries removed: ${jsonScrub.removed.length}`)
  if (tsScrubs.length > 0)
    console.log(`   capacitor.config.ts/.js entries removed: ${totalTsRemoved}`)
}

main()
