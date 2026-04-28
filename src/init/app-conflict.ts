export function isAppAlreadyExistsError(error: unknown): boolean {
  const errorMessage = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return errorMessage.includes('already exist')
    || errorMessage.includes('duplicate key')
    || errorMessage.includes('23505')
}

export function buildAppIdConflictSuggestions(
  baseAppId: string,
  random = Math.random,
  now = Date.now,
): string[] {
  const randomSuffix = random().toString(36).substring(2, 6) || 'dev'
  return [
    `${baseAppId}-${randomSuffix}`,
    `${baseAppId}.dev`,
    `${baseAppId}.app`,
    `${baseAppId}-${now().toString().slice(-4)}`,
    `${baseAppId}2`,
    `${baseAppId}3`,
  ]
}
