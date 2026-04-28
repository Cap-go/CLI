import { exit, stdin, stdout } from 'node:process'
import { normalizeRunDevicePlatform, resolveRunDeviceCommand, runPackageRunnerSync } from './init/command'
import { cancel as pCancel, intro as pIntro, log as pLog, outro as pOutro, spinner as pSpinner } from './init/prompts'
import { setInitScreen } from './init/runtime'
import { formatRunnerCommand } from './runner-command'
import { formatError, getPMAndCommand } from './utils'

interface RunDeviceTestOptions {
  launch?: boolean
}

async function exitCanceledRunDeviceTest(): Promise<never> {
  pOutro('Run-device test canceled.')
  exit(1)
}

function canSelectRunDeviceTargetInteractively(): boolean {
  return !!stdin.isTTY && !!stdout.isTTY
}

function handleNonInteractiveIosRunDevice(pm: ReturnType<typeof getPMAndCommand>): never {
  pLog.info('Non-interactive mode: iOS target selection needs an interactive terminal.')
  pLog.info(`List targets with: ${formatRunnerCommand(pm.runner, ['cap', 'run', 'ios', '--list'])}`)
  pLog.info(`Run a concrete target with: ${formatRunnerCommand(pm.runner, ['cap', 'run', 'ios', '--target', '<id>'])}`)
  pCancel('Run-device test failed.')
  exit(1)
}

export async function testRunDeviceCommand(platformName?: string, options: RunDeviceTestOptions = {}) {
  try {
    const pm = getPMAndCommand()
    const platformNameChoice = normalizeRunDevicePlatform(platformName)

    pIntro('Run device test')
    setInitScreen({
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

    if (platformNameChoice === 'ios' && !canSelectRunDeviceTargetInteractively())
      handleNonInteractiveIosRunDevice(pm)

    const runCommand = await resolveRunDeviceCommand(exitCanceledRunDeviceTest, pm, platformNameChoice)
    if (!runCommand.args) {
      pOutro(`Skipped device launch. Manual command: ${runCommand.command}`)
      return
    }

    if (options.launch === false) {
      pOutro(`Resolved run command: ${runCommand.command}`)
      return
    }

    const s = pSpinner()
    s.start(`Running: ${runCommand.command}`)

    const runResult = runPackageRunnerSync(pm.runner, runCommand.args, { stdio: 'inherit' })
    const runFailed = runResult.error || runResult.status !== 0

    if (runFailed) {
      s.stop('App failed to start ❌')
      if (runResult.error)
        pLog.error(formatError(runResult.error))
      pLog.info(`You can run the command manually with: ${runCommand.command}`)
      pCancel('Run-device test failed.')
      exit(1)
    }

    s.stop('App started ✅')
    pOutro(`Run-device test finished. Manual command: ${runCommand.command}`)
  }
  catch (error) {
    pCancel(`Run-device test failed: ${formatError(error)}`)
    exit(1)
  }
}
