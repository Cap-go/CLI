export function formatRunnerCommand(runner: string, args: string[]): string {
  return `${runner} ${args.join(' ')}`
}

export function splitRunnerCommand(runner: string): { command: string, args: string[] } {
  const parts = runner.split(' ').map(part => part.trim()).filter(Boolean)
  const [command = runner, ...args] = parts
  return { command, args }
}
