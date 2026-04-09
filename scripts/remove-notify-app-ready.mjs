#!/usr/bin/env node
/**
 * remove-notify-app-ready.mjs
 *
 * Reverts the `CapacitorUpdater.notifyAppReady()` injection that
 * `capgo init` adds to a user's project. Intended for re-running the
 * onboarding flow against a demo / test app.
 *
 * It removes, from every source file under the target directory:
 *   1. `CapacitorUpdater.notifyAppReady()` statements (line is dropped if
 *      the call is the only thing on it, otherwise only the call is
 *      stripped).
 *   2. `import { CapacitorUpdater } from '@capgo/capacitor-updater'`
 *      import lines — but only if no other references to
 *      `CapacitorUpdater` remain in the file after the call is removed.
 *   3. Nuxt plugin file `plugins/capacitorUpdater.client.{ts,js}` is
 *      deleted outright when it only contained the notifyAppReady
 *      wrapper.
 *
 * Usage:
 *   node scripts/remove-notify-app-ready.mjs [targetDir]
 *
 * Defaults to the current working directory.
 * Pass `--dry-run` to preview without writing.
 */

import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { argv, cwd, exit } from 'node:process'

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'])
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  'android',
  'ios',
  'coverage',
  '.cache',
  '.turbo',
])

const CALL_RE = /CapacitorUpdater\s*\.\s*notifyAppReady\s*\(\s*\)\s*;?/g
const IMPORT_RE = /^\s*import\s*\{\s*CapacitorUpdater\s*\}\s*from\s*['"]@capgo\/capacitor-updater['"]\s*;?\s*$/

/**
 * @param {string} dir
 * @param {string[]} acc
 */
function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry))
      continue
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    }
    catch {
      continue
    }
    if (stat.isDirectory()) {
      walk(full, acc)
    }
    else if (stat.isFile() && SOURCE_EXTS.has(extname(entry))) {
      acc.push(full)
    }
  }
  return acc
}

/**
 * @param {string} content
 * @returns {{ next: string, removedCalls: number }}
 */
function stripNotifyCalls(content) {
  let removedCalls = 0

  // First: drop full lines whose *only* non-whitespace content is the call.
  const lines = content.split('\n')
  const kept = lines.filter((line) => {
    const trimmed = line.trim()
    const onlyCall = /^CapacitorUpdater\s*\.\s*notifyAppReady\s*\(\s*\)\s*;?\s*$/.test(trimmed)
    if (onlyCall) {
      removedCalls += 1
      return false
    }
    return true
  })

  // Then: inline occurrences (call embedded in a larger expression) — strip
  // the call but keep surrounding code. Rare, but handle it safely.
  let next = kept.join('\n').replace(CALL_RE, () => {
    removedCalls += 1
    return ''
  })

  // Collapse 3+ consecutive blank lines left behind by the removal.
  next = next.replace(/\n{3,}/g, '\n\n')
  return { next, removedCalls }
}

/**
 * @param {string} content
 * @returns {{ next: string, removedImport: boolean }}
 */
function stripUnusedImport(content) {
  const lines = content.split('\n')
  let removed = false
  const kept = lines.filter((line) => {
    if (IMPORT_RE.test(line)) {
      removed = true
      return false
    }
    return true
  })
  if (!removed)
    return { next: content, removedImport: false }

  // If the file still references `CapacitorUpdater`, the import was still
  // needed — restore the file as-is.
  const withoutImports = kept.join('\n')
  if (/\bCapacitorUpdater\b/.test(withoutImports)) {
    return { next: content, removedImport: false }
  }
  return { next: withoutImports, removedImport: true }
}

/**
 * @param {string} filePath
 * @param {boolean} dryRun
 */
function processFile(filePath, dryRun) {
  const original = readFileSync(filePath, 'utf8')
  if (!original.includes('notifyAppReady') && !/\bCapacitorUpdater\b/.test(original))
    return null

  const { next: afterCalls, removedCalls } = stripNotifyCalls(original)
  const { next: afterImport, removedImport } = stripUnusedImport(afterCalls)

  if (removedCalls === 0 && !removedImport)
    return null

  if (!dryRun)
    writeFileSync(filePath, afterImport, 'utf8')

  return { removedCalls, removedImport }
}

/**
 * @param {string} targetDir
 * @param {boolean} dryRun
 */
function deleteEmptyNuxtPlugin(targetDir, dryRun) {
  const candidates = [
    join(targetDir, 'plugins', 'capacitorUpdater.client.ts'),
    join(targetDir, 'plugins', 'capacitorUpdater.client.js'),
  ]
  const removed = []
  for (const file of candidates) {
    try {
      const contents = readFileSync(file, 'utf8')
      const trimmed = contents.replace(/\s+/g, '')
      // Only delete if the file is just the canonical injected wrapper.
      const canonical = trimmed.includes('defineNuxtPlugin')
        && trimmed.includes('CapacitorUpdater.notifyAppReady()')
      if (!canonical)
        continue
      if (!dryRun)
        rmSync(file)
      removed.push(file)
    }
    catch {
      // file not present — ignore
    }
  }
  return removed
}

function main() {
  const args = argv.slice(2)
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

  console.log(`${dryRun ? '🔎 Dry run — ' : '🧹 '}Scanning ${targetDir}`)

  const files = walk(targetDir)
  let filesChanged = 0
  let totalCalls = 0
  let totalImports = 0

  for (const file of files) {
    const result = processFile(file, dryRun)
    if (!result)
      continue
    filesChanged += 1
    totalCalls += result.removedCalls
    totalImports += result.removedImport ? 1 : 0
    console.log(
      `  ${dryRun ? 'would edit' : 'edited'} ${relative(targetDir, file)}`
      + ` (calls removed: ${result.removedCalls}`
      + `${result.removedImport ? ', import removed' : ''})`,
    )
  }

  const removedNuxt = deleteEmptyNuxtPlugin(targetDir, dryRun)
  for (const file of removedNuxt) {
    console.log(`  ${dryRun ? 'would delete' : 'deleted'} ${relative(targetDir, file)}`)
  }

  console.log('')
  console.log(`✅ ${dryRun ? 'Would change' : 'Changed'} ${filesChanged} file(s)`)
  console.log(`   notifyAppReady() calls removed: ${totalCalls}`)
  console.log(`   @capgo/capacitor-updater imports removed: ${totalImports}`)
  if (removedNuxt.length > 0)
    console.log(`   Nuxt plugin files removed: ${removedNuxt.length}`)
}

main()
