import { spawnSync } from 'node:child_process'

const defaultStarOwner = 'Cap-go'
export const defaultStarRepo = 'capacitor-updater'
const defaultStarTarget = `${defaultStarOwner}/${defaultStarRepo}`
const defaultStarPrefix = 'capacitor-'
const fallbackStarRepositories = [defaultStarTarget] as const
const defaultMinStarDelayMs = 20
const defaultMaxStarDelayMs = 180
const starredRepoSessionCache = new Set<string>()

type GhCommandResult = {
  status: number
  stderr: string
  stdout: string
}

export type StarAllRepositoryStatus = 'starred' | 'already_starred' | 'skipped' | 'failed'

export interface StarAllRepositoryResult {
  repository: string
  alreadyStarred: boolean
  skipped: boolean
  error?: string
  status: StarAllRepositoryStatus
}

export interface StarAllRepositoriesOptions {
  repositories?: string[]
  minDelayMs?: number
  maxDelayMs?: number
  onProgress?: (result: StarAllRepositoryResult) => void
  onDiscovery?: (message: string) => void
}

function normalizeRepositoryForCache(repository: string) {
  return repository.toLowerCase()
}

export function markRepoStarredInSession(repository: string) {
  starredRepoSessionCache.add(normalizeRepositoryForCache(repository))
}

export function isRepoStarredInSession(repositoryInput?: string): boolean {
  const repository = normalizeGithubRepo(repositoryInput)
  return starredRepoSessionCache.has(normalizeRepositoryForCache(repository))
}

function normalizeDelayMs(value: number | undefined, fallback: number) {
  if (typeof value !== 'number')
    return fallback

  if (!Number.isFinite(value))
    return fallback

  if (value < 0)
    return fallback

  return Math.floor(value)
}

function getDelayRange(minDelayMs?: number, maxDelayMs?: number) {
  const min = normalizeDelayMs(minDelayMs, defaultMinStarDelayMs)
  const max = normalizeDelayMs(maxDelayMs, defaultMaxStarDelayMs)
  if (min <= max)
    return { min, max }

  return { min: max, max: min }
}

function getRandomDelayMs(minDelayMs: number, maxDelayMs: number) {
  if (minDelayMs === maxDelayMs)
    return minDelayMs
  return Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs
}

async function sleep(ms: number) {
  if (ms <= 0)
    return
  return new Promise(resolve => setTimeout(resolve, ms))
}

function dedupeRepositories(repositories: string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const repository of repositories) {
    const normalizedRepository = normalizeGithubRepo(repository)
    const cacheKey = normalizeRepositoryForCache(normalizedRepository)
    if (!seen.has(cacheKey)) {
      seen.add(cacheKey)
      result.push(normalizedRepository)
    }
  }

  return result
}

async function getDefaultCapgoStarRepositories(onDiscovery?: (message: string) => void): Promise<string[]> {
  onDiscovery?.(`🔎 Discovering repositories in ${defaultStarOwner} org...`)

  const apiResult = executeGhCommand([
    'api',
    '--paginate',
    `orgs/${defaultStarOwner}/repos`,
    '--jq',
    `map(select(.name | startswith("${defaultStarPrefix}")) | .nameWithOwner)[]`,
  ])

  if (apiResult.status === 0 && apiResult.stdout.trim().length > 0) {
    const repositories = apiResult.stdout
      .split('\n')
      .map(repo => repo.trim())
      .filter(repo => repo.length > 0)

    if (repositories.length > 0) {
      onDiscovery?.(`✅ Found ${repositories.length} matching repositories with API pagination.`)
      return dedupeRepositories(repositories)
    }

    onDiscovery?.(`⚠️ No matching repositories found with paginated API, trying fallback query.`)
  }
  else {
    onDiscovery?.('⚠️ Could not use paginated API, trying fallback query.')
  }

  const fallbackResult = executeGhCommand(['api', `orgs/${defaultStarOwner}/repos?per_page=100`])
  if (fallbackResult.status !== 0) {
    onDiscovery?.('⚠️ Fallback query failed, using default starred repository list.')
    return [...fallbackStarRepositories]
  }

  try {
    const parsed = JSON.parse(fallbackResult.stdout)
    if (!Array.isArray(parsed)) {
      onDiscovery?.('⚠️ Fallback response was not an array, using default starred repository list.')
      return [...fallbackStarRepositories]
    }

    const repositories = parsed
      .filter((repo): repo is { name?: string } => typeof repo === 'object' && repo !== null)
      .map(repo => repo.name)
      .filter((name): name is string => !!name && name.startsWith(defaultStarPrefix))
      .map(name => `${defaultStarOwner}/${name}`)

    if (repositories.length > 0) {
      onDiscovery?.(`✅ Found ${repositories.length} matching repositories with fallback query.`)
      return dedupeRepositories(repositories)
    }
  }
  catch {
    onDiscovery?.('⚠️ Fallback query response could not be parsed, using default starred repository list.')
    return [...fallbackStarRepositories]
  }

  onDiscovery?.('⚠️ No matching repositories found, using default starred repository list.')
  return [...fallbackStarRepositories]
}

function executeGhCommand(args: string[]): GhCommandResult {
  try {
    const result = spawnSync('gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    return {
      status: result.status ?? 1,
      stderr: result.stderr?.toString() ?? '',
      stdout: result.stdout?.toString() ?? '',
    }
  }
  catch {
    return { status: 1, stderr: '`gh` command is not available in PATH.', stdout: '' }
  }
}

export interface RepoStarStatus {
  repository: string
  ghInstalled: boolean
  ghLoggedIn: boolean
  repositoryExists: boolean
  starred: boolean
}

export function normalizeGithubRepo(repository?: string): string {
  const rawRepository = repository?.trim() || defaultStarTarget

  const sanitized = rawRepository.replace(/\.git$/i, '')
  if (/^https?:\/\//.test(sanitized)) {
    try {
      const url = new URL(sanitized)
      if (url.hostname.endsWith('github.com')) {
        const [owner, name] = url.pathname
          .split('/')
          .filter(part => part.length > 0)
        if (owner && name)
          return `${owner}/${name}`
      }
    }
    catch {
      // Continue with generic normalization below
    }
  }

  if (sanitized.startsWith('git@github.com:')) {
    const [, path] = sanitized.split('git@github.com:')
    if (path) {
      const [owner, name] = path.split('/')
      if (owner && name)
        return `${owner}/${name}`
    }
  }

  if (sanitized.includes('/')) {
    const [owner, repoName] = sanitized.split('/')
    if (owner && repoName)
      return `${owner}/${repoName}`
  }

  return `${defaultStarOwner}/${sanitized}`
}

function repositoryExists(repository: string) {
  const result = executeGhCommand(['repo', 'view', repository, '--json', 'nameWithOwner'])
  return result.status === 0
}

function checkIfStarred(repository: string) {
  const result = executeGhCommand(['api', '-X', 'GET', `/user/starred/${repository}`])
  if (result.status === 0)
    return true
  if (result.status === 1)
    return false

  throw new Error(`Unable to check star status for ${repository}.`)
}

export function isGhInstalled() {
  return executeGhCommand(['--version']).status === 0
}

export function isGhLoggedIn() {
  return executeGhCommand(['auth', 'status']).status === 0
}

export function getRepoStarStatus(repositoryInput?: string): RepoStarStatus {
  const repository = normalizeGithubRepo(repositoryInput)

  if (!isGhInstalled()) {
    return {
      repository,
      ghInstalled: false,
      ghLoggedIn: false,
      repositoryExists: false,
      starred: false,
    }
  }

  if (!isGhLoggedIn()) {
    return {
      repository,
      ghInstalled: true,
      ghLoggedIn: false,
      repositoryExists: false,
      starred: false,
    }
  }

  const exists = repositoryExists(repository)
  if (!exists) {
    return {
      repository,
      ghInstalled: true,
      ghLoggedIn: true,
      repositoryExists: false,
      starred: false,
    }
  }

  return {
    repository,
    ghInstalled: true,
    ghLoggedIn: true,
    repositoryExists: true,
    starred: checkIfStarred(repository),
  }
}

export async function starAllRepositories(options: StarAllRepositoriesOptions = {}): Promise<StarAllRepositoryResult[]> {
  const repositoriesToStar = options.repositories?.length
    ? options.repositories
    : await getDefaultCapgoStarRepositories(options.onDiscovery)

  options.onDiscovery?.(`🧮 Prepared ${repositoriesToStar.length} repositories to process.`)

  const delayRange = getDelayRange(options.minDelayMs, options.maxDelayMs)
  const normalizedRepositories = dedupeRepositories(repositoriesToStar)

  const results: StarAllRepositoryResult[] = []

  for (let i = 0; i < normalizedRepositories.length; i++) {
    const repository = normalizedRepositories[i]
    if (isRepoStarredInSession(repository)) {
      const result = {
        repository,
        alreadyStarred: true,
        skipped: true,
        status: 'already_starred' as const,
      }
      options.onProgress?.(result)
      results.push(result as StarAllRepositoryResult)
      continue
    }

    try {
      const result = starRepository(repository)
      const starResult = {
        repository: result.repository,
        alreadyStarred: result.alreadyStarred,
        skipped: false,
        status: result.alreadyStarred ? 'already_starred' as const : 'starred' as const,
      }
      options.onProgress?.(starResult)
      results.push(starResult as StarAllRepositoryResult)
    }
    catch (error) {
      const failedResult = {
        repository,
        alreadyStarred: false,
        skipped: false,
        status: 'failed' as const,
        error: error instanceof Error ? error.message : String(error),
      }
      options.onProgress?.(failedResult)
      results.push(failedResult as StarAllRepositoryResult)
    }

    if (i + 1 < normalizedRepositories.length)
      await sleep(getRandomDelayMs(delayRange.min, delayRange.max))
  }

  return results
}

export function starRepository(repositoryInput?: string): { repository: string; alreadyStarred: boolean } {
  const repository = normalizeGithubRepo(repositoryInput)
  const status = getRepoStarStatus(repository)

  if (!status.ghInstalled)
    throw new Error('GitHub CLI (`gh`) is not installed. Install it from https://cli.github.com/')

  if (!status.ghLoggedIn)
    throw new Error('GitHub CLI is not logged in. Run `gh auth login` first.')

  if (!status.repositoryExists)
    throw new Error(`Cannot star ${repository}: repository is not reachable or does not exist.`)

  if (status.starred) {
    markRepoStarredInSession(repository)
    return { repository, alreadyStarred: true }
  }

  const starResult = executeGhCommand(['api', '-X', 'PUT', `/user/starred/${repository}`])
  if (starResult.status !== 0) {
    const message = starResult.stderr || starResult.stdout || `GitHub returned status ${starResult.status}`
    throw new Error(`Failed to star ${repository}: ${message.trim()}`)
  }

  markRepoStarredInSession(repository)
  return { repository, alreadyStarred: false }
}
