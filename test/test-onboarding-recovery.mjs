import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { getBuildOnboardingRecoveryAdvice } from '../src/build/onboarding/recovery.ts'
import { renderOnboardingSupportBundle, writeOnboardingSupportBundle } from '../src/onboarding-support.ts'

let failures = 0

function t(name, fn) {
  try {
    fn()
    console.log(`✓ ${name}`)
  }
  catch (error) {
    failures += 1
    console.error(`❌ ${name}`)
    console.error(error)
  }
}

t('build onboarding advice suggests platform creation commands', () => {
  const advice = getBuildOnboardingRecoveryAdvice('No ios/ directory found.', 'no-platform', 'bunx', 'com.example.app')
  if (!advice.commands.includes('bunx cap add ios'))
    throw new Error('Expected bunx cap add ios command in recovery advice')
  if (!advice.commands.includes('bunx cap sync ios'))
    throw new Error('Expected bunx cap sync ios command in recovery advice')
})

t('build onboarding advice suggests login and build request after missing auth', () => {
  const advice = getBuildOnboardingRecoveryAdvice('No Capgo API key found.', 'requesting-build', 'bunx', 'com.example.app')
  if (!advice.commands.includes('bunx @capgo/cli@latest login'))
    throw new Error('Expected login command in recovery advice')
  if (!advice.commands.includes('bunx @capgo/cli@latest build request com.example.app --platform ios'))
    throw new Error('Expected build request command in recovery advice')
})

t('support bundle renderer includes commands and docs', () => {
  const output = renderOnboardingSupportBundle({
    kind: 'init',
    appId: 'com.example.app',
    currentStep: 'Step 4/12 · Add Integration Code',
    packageManager: 'bun',
    cwd: '/tmp/example',
    error: 'Something failed',
    commands: ['bunx @capgo/cli@latest doctor'],
    docs: ['https://capgo.app/docs/getting-started/onboarding/'],
    sections: [{ title: 'Context', lines: ['line one'] }],
    logs: ['log one'],
  })

  if (!output.includes('bunx @capgo/cli@latest doctor'))
    throw new Error('Expected command in support bundle output')
  if (!output.includes('https://capgo.app/docs/getting-started/onboarding/'))
    throw new Error('Expected docs URL in support bundle output')
  if (!output.includes('Current step: Step 4/12 · Add Integration Code'))
    throw new Error('Expected current step in support bundle output')
})

t('support bundle writer persists a file', () => {
  const home = join(tmpdir(), `capgo-home-${Date.now()}`)
  process.env.HOME = home
  const filePath = writeOnboardingSupportBundle({
    kind: 'build-init',
    appId: 'com.example.app',
    error: 'broken',
  })

  if (!existsSync(filePath))
    throw new Error('Expected support bundle file to exist')

  const contents = readFileSync(filePath, 'utf8')
  if (!contents.includes('Capgo build-init support bundle'))
    throw new Error('Expected support bundle header in file')

  rmSync(home, { recursive: true, force: true })
})

if (failures > 0) {
  console.error(`\n❌ ${failures} onboarding recovery test(s) failed`)
  process.exit(1)
}

console.log('\n✅ onboarding recovery tests passed')
