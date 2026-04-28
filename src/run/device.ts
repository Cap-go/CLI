import type { PlatformChoice } from '../init/command'
import { exit, stdin, stdout } from 'node:process'
import { log as clackLog } from '@clack/prompts'
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
  clackLog.info('Non-interactive mode: iOS target selection needs an interactive terminal.')
  clackLog.info(`List targets with: ${formatRunnerCommand(pm.runner, ['cap', 'run', 'ios', '--list'])}`)
  clackLog.info(`Run a concrete target with: ${formatRunnerCommand(pm.runner, ['cap', 'run', 'ios', '--target', '<id>'])}`)
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
    const platformNameChoice = normalizeRunDevicePlatform(platformName)

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

    setInitScreen({
      headerTitle: '📱  Capgo Run Device',
      title: 'Run Device Test',
      introLines: [
        'This uses the same device target picker as init onboarding.',
        platformNameChoice === 'ios'
          ? 'For iOS, choose a physical device or simulator, then refresh target discovery if needed.'
          : 'For Android, this runs Capacitor directly.',
      ],
      phaseLabel: 'Device target',
      statusLine: `Platform: ${platformNameChoice.toUpperCase()}`,
      tone: 'blue',
    })

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
