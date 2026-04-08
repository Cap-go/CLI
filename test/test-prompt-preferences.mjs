#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testHome = mkdtempSync(join(tmpdir(), 'capgo-prompt-prefs-'))
process.env.HOME = testHome

console.log('🧪 Testing prompt preference persistence...\n')

const {
  getRememberedPromptPreference,
  promptPreferencesPath,
  rememberPromptPreference,
} = await import('../src/promptPreferences.ts')

let failures = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  }
  catch (error) {
    failures += 1
    console.error(`❌ ${name}`)
    console.error(error)
  }
}

await test('missing preference file returns undefined', async () => {
  assert.equal(await getRememberedPromptPreference('uploadStarCapgoRepo'), undefined)
  assert.equal(existsSync(promptPreferencesPath), false)
})

await test('remembered choices persist to disk', async () => {
  await rememberPromptPreference('uploadStarCapgoRepo', false)
  await rememberPromptPreference('uploadShowReplicationProgress', true)

  assert.equal(await getRememberedPromptPreference('uploadStarCapgoRepo'), false)
  assert.equal(await getRememberedPromptPreference('uploadShowReplicationProgress'), true)

  const stored = JSON.parse(readFileSync(promptPreferencesPath, 'utf8'))
  assert.deepEqual(stored, {
    uploadStarCapgoRepo: false,
    uploadShowReplicationProgress: true,
  })
})

await test('invalid preference files are ignored safely', async () => {
  writeFileSync(promptPreferencesPath, '{not-json', 'utf8')
  assert.equal(await getRememberedPromptPreference('uploadStarCapgoRepo'), undefined)
})

if (failures > 0) {
  console.error(`\n❌ ${failures} prompt preference test(s) failed`)
  process.exit(1)
}

console.log('\n✅ Prompt preferences persist correctly')
