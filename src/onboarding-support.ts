import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface OnboardingSupportSection {
  title: string
  lines: string[]
}

export interface OnboardingSupportBundleInput {
  kind: 'init' | 'build-init'
  error: string
  appId?: string
  currentStep?: string
  packageManager?: string
  cwd?: string
  commands?: string[]
  docs?: string[]
  logs?: string[]
  sections?: OnboardingSupportSection[]
}

function sanitizeSegment(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  if (!trimmed)
    return fallback
  return trimmed.replaceAll(/[^\w.-]+/g, '-').replaceAll(/-+/g, '-').replaceAll(/^-|-$/g, '') || fallback
}

function nowStamp(): string {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
}

export function renderOnboardingSupportBundle(input: OnboardingSupportBundleInput): string {
  const lines: string[] = [
    `Capgo ${input.kind} support bundle`,
    `Generated: ${new Date().toISOString()}`,
    `Error: ${input.error}`,
  ]

  if (input.appId)
    lines.push(`App ID: ${input.appId}`)
  if (input.currentStep)
    lines.push(`Current step: ${input.currentStep}`)
  if (input.packageManager)
    lines.push(`Package manager: ${input.packageManager}`)
  if (input.cwd)
    lines.push(`Working directory: ${input.cwd}`)

  if (input.commands?.length) {
    lines.push('', 'Recommended commands:')
    for (const command of input.commands) {
      lines.push(`- ${command}`)
    }
  }

  if (input.docs?.length) {
    lines.push('', 'Docs:')
    for (const doc of input.docs) {
      lines.push(`- ${doc}`)
    }
  }

  if (input.sections?.length) {
    for (const section of input.sections) {
      lines.push('', `${section.title}:`)
      for (const line of section.lines) {
        lines.push(line)
      }
    }
  }

  if (input.logs?.length) {
    lines.push('', 'Recent logs:')
    for (const line of input.logs) {
      lines.push(line)
    }
  }

  return `${lines.join('\n')}\n`
}

export function writeOnboardingSupportBundle(input: OnboardingSupportBundleInput): string {
  const supportDir = join(homedir(), '.capgo-credentials', 'support')
  mkdirSync(supportDir, { recursive: true })

  const kind = sanitizeSegment(input.kind, 'onboarding')
  const app = sanitizeSegment(input.appId, 'unknown-app')
  const filename = `${kind}-${app}-${nowStamp()}.log`
  const filePath = join(supportDir, filename)

  writeFileSync(filePath, renderOnboardingSupportBundle(input), 'utf8')
  return filePath
}
