// src/build/onboarding/command.ts
import { render } from 'ink'
import process from 'node:process'
import React from 'react'
import { log } from '@clack/prompts'
import { getAppId, getConfig } from '../../utils.js'
import { loadProgress } from './progress.js'
import OnboardingApp from './ui/app.js'

export async function onboardingCommand(): Promise<void> {
  // Detect app ID from capacitor.config.ts
  let appId: string | undefined
  try {
    const extConfig = await getConfig()
    appId = getAppId(undefined, extConfig?.config)
  }
  catch {
    // getConfig may throw if not in a Capacitor project
  }

  if (!appId) {
    log.error('Could not detect app ID from capacitor.config.ts. Make sure you are in a Capacitor project directory.')
    process.exit(1)
  }

  // Load any existing progress
  const progress = await loadProgress(appId)

  // Launch Ink app
  const { waitUntilExit } = render(
    React.createElement(OnboardingApp, { appId, initialProgress: progress }),
  )

  await waitUntilExit()
}
