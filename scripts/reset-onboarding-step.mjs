#!/usr/bin/env node
/**
 * reset-onboarding-step.mjs
 *
 * TEST-ONLY helper for iterating on the `capgo init` onboarding flow.
 * Rewrites the `step_done` field of the persisted onboarding state file
 * (the tmp file created by `capgo init` — lives in the OS tmp dir and
 * starts with the `capgocli` prefix) so the next `capgo init` run resumes
 * at the requested step.
 *
 * NOT shipped as a CLI subcommand on purpose — this is only useful when
 * manually QA'ing the wizard, never for end users.
 *
 * Usage:
 *   node scripts/reset-onboarding-step.mjs            # resets to step 3
 *   node scripts/reset-onboarding-step.mjs 5          # resets to step 5
 *   node scripts/reset-onboarding-step.mjs --show     # only prints current state
 *   node scripts/reset-onboarding-step.mjs --clear    # deletes the state file
 */

import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { argv, exit } from 'node:process'

const TMP_PREFIX = 'capgocli'

function findStateFile() {
  const dir = tmpdir()
  const match = readdirSync(dir).find(name => name.startsWith(TMP_PREFIX))
  return match ? join(dir, match) : undefined
}

function parseStep(raw) {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) {
    console.error(`❌ Invalid step "${raw}". Expected a non-negative integer.`)
    exit(1)
  }
  return n
}

function main() {
  const args = argv.slice(2)
  const show = args.includes('--show')
  const clear = args.includes('--clear')
  const positional = args.filter(a => !a.startsWith('--'))

  const file = findStateFile()

  if (clear) {
    if (!file) {
      console.log('ℹ️  No onboarding state file to clear.')
      return
    }
    rmSync(file)
    console.log(`🗑  Deleted ${file}`)
    return
  }

  if (!file) {
    console.error('❌ No onboarding state file found in the tmp dir.')
    console.error('   Run `capgo init` at least once so the state file is created, then re-run this script.')
    exit(1)
  }

  let parsed = {}
  try {
    const raw = readFileSync(file, 'utf8')
    parsed = raw.length > 0 ? JSON.parse(raw) : {}
  }
  catch (err) {
    console.error(`❌ Cannot read ${file}: ${err.message}`)
    exit(1)
  }

  if (show) {
    console.log(`📄 ${file}`)
    console.log(JSON.stringify(parsed, null, 2))
    return
  }

  const nextStep = parseStep(positional[0] ?? '3')
  const prev = parsed.step_done
  const next = { ...parsed, step_done: nextStep }

  writeFileSync(file, JSON.stringify(next), 'utf8')

  console.log(`✅ ${file}`)
  console.log(`   step_done: ${prev ?? 'unset'} → ${nextStep}`)
  if (!parsed.orgId) {
    console.log('⚠️  Note: no `orgId` in the state file — `capgo init` will still start fresh until you sign in.')
  }
}

main()
