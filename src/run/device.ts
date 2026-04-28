import type { PlatformChoice } from '../init/command'
import { exit, stdin, stdout } from 'node:process'
import { cancel as clackCancel, isCancel as clackIsCancel, log as clackLog, select as clackSelect } from '@clack/prompts'
import { normalizeRunDevicePlatform, resolveRunDeviceCommand, runPackageRunnerSync } from '../init/command'
import { cancel as pCancel, log as pLog, outro as pOutro, spinner as pSpinner } from '../init/prompts'
import { setInitScreen } from '../init/runtime'
import { formatRunnerCommand } from '../runner-command'
import { formatError, getPMAndCommand } from '../utils'

interface RunDeviceTestOptions {
  launch?: boolean
}

async function exitCanceledRunDeviceTest(): Promise<never> {
  pOutro('Run device test canceled.')
  exit(1)
}

function canSelectRunDeviceTargetInteractively(): boolean {
  return !!stdin.isTTY && !!stdout.isTTY
}

function handleNonInteractiveIosRunDevice(pm: ReturnType<typeof getPMAndCommand>): never {
  clackLog.info('Non-interactive mode: iOS device selection needs an interactive terminal.')
  clackLog.info(`List devices with: ${formatRunnerCommand(pm.runner, ['cap', 'run', 'ios', '--list'])}`)
  clackLog.info(`Run a specific device with: ${formatRunnerCommand(pm.runner, ['cap', 'run', 'ios', '--target', '<id>'])}`)
  clackLog.error('Run device test failed.')
  exit(1)
}

function failRunDeviceTest(message: string, interactive: boolean): never {
  if (interactive)
    pCancel(message)
  else
    clackLog.error(message)
  exit(1)
}

function finishRunDeviceTest(message: string, interactive: boolean): void {
  if (interactive)
    pOutro(message)
  else
    clackLog.info(message)
}

function getNonInteractiveRunDeviceCommand(pm: ReturnType<typeof getPMAndCommand>, platformName: PlatformChoice): { args: string[], command: string } {
  const args = ['cap', 'run', platformName]
  return { args, command: formatRunnerCommand(pm.runner, args) }
}

async function selectRunDevicePlatform(platformName: string | undefined, interactive: boolean): Promise<PlatformChoice> {
  if (platformName)
    return normalizeRunDevicePlatform(platformName)

  if (!interactive)
    throw new Error('No platform provided. Run in an interactive terminal to choose iOS or Android, or pass "ios" or "android".')

  const selectedPlatform = await clackSelect({
    message: 'You did not provide a platform. Which platform do you want to start on?',
    options: [
      { value: 'ios', label: 'iOS' },
      { value: 'android', label: 'Android' },
    ],
  })

  if (clackIsCancel(selectedPlatform)) {
    clackCancel('Run device test canceled.')
    exit(1)
  }

  return selectedPlatform as PlatformChoice
}

function setRunDeviceScreen(platformName: PlatformChoice): void {
  const platformLabel = platformName === 'ios' ? 'iOS' : 'Android'
  setInitScreen({
    headerTitle: '📱  Capgo Run Device',
    title: 'Run Device',
    introLines: [
      `${platformLabel} selected.`,
      platformName === 'ios'
        ? 'Pick a physical device or simulator.'
        : 'Pick a device or emulator.',
    ],
    phaseLabel: 'Device',
    statusLine: 'Reload the list if your target is not visible yet.',
    tone: 'blue',
  })
}

function runResolvedDeviceCommand(pm: ReturnType<typeof getPMAndCommand>, runCommand: { args: string[], command: string }, interactive: boolean): void {
  if (interactive) {
    const s = pSpinner()
    s.start(`Running: ${runCommand.command}`)

    const runResult = runPackageRunnerSync(pm.runner, runCommand.args, { stdio: 'inherit' })
    const runFailed = runResult.error || runResult.status !== 0

    if (runFailed) {
      s.stop('App failed to start ❌')
      if (runResult.error)
        pLog.error(formatError(runResult.error))
      pLog.info(`You can run the command manually with: ${runCommand.command}`)
      failRunDeviceTest('Run device test failed.', interactive)
    }

    s.stop('App started ✅')
    return
  }

  clackLog.info(`Running: ${runCommand.command}`)
  const runResult = runPackageRunnerSync(pm.runner, runCommand.args, { stdio: 'inherit' })
  const runFailed = runResult.error || runResult.status !== 0

  if (runFailed) {
    if (runResult.error)
      clackLog.error(formatError(runResult.error))
    clackLog.info(`You can run the command manually with: ${runCommand.command}`)
    failRunDeviceTest('Run device test failed.', interactive)
  }

  clackLog.info('App started')
}

export async function testRunDeviceCommand(platformName?: string, options: RunDeviceTestOptions = {}) {
  const interactive = canSelectRunDeviceTargetInteractively()
  try {
    const pm = getPMAndCommand()
    const platformNameChoice = await selectRunDevicePlatform(platformName, interactive)

    if (!interactive) {
      const runCommand = getNonInteractiveRunDeviceCommand(pm, platformNameChoice)
      if (options.launch === false) {
        finishRunDeviceTest(`Resolved run command: ${runCommand.command}`, interactive)
        return
      }

      if (platformNameChoice === 'ios')
        handleNonInteractiveIosRunDevice(pm)

      runResolvedDeviceCommand(pm, runCommand, interactive)
      finishRunDeviceTest(`Run device test finished. Manual command: ${runCommand.command}`, interactive)
      return
    }

    setRunDeviceScreen(platformNameChoice)
    const runCommand = await resolveRunDeviceCommand(exitCanceledRunDeviceTest, pm, platformNameChoice)
    if (!runCommand.args) {
      finishRunDeviceTest(`Skipped device launch. Manual command: ${runCommand.command}`, interactive)
      return
    }

    if (options.launch === false) {
      finishRunDeviceTest(`Resolved run command: ${runCommand.command}`, interactive)
      return
    }

    runResolvedDeviceCommand(pm, runCommand, interactive)
    finishRunDeviceTest(`Run device test finished. Manual command: ${runCommand.command}`, interactive)
  }
  catch (error) {
    failRunDeviceTest(`Run device test failed: ${formatError(error)}`, interactive)
  }
}
