import { chmod, lstat, mkdir, readFile, rename, rm, writeFile, appendFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

type WriteOptions = {
  mode?: number
  encoding?: BufferEncoding
}

async function ensureNotSymlink(path: string): Promise<void> {
  try {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to access symbolic link path: ${path}`)
    }
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw error
  }
}

export async function ensureSecureDirectory(path: string, mode: number): Promise<void> {
  await ensureNotSymlink(path)
  await mkdir(path, { recursive: true, mode })
  const stat = await lstat(path)
  if (!stat.isDirectory())
    throw new Error(`Expected a directory at ${path}`)
  await chmod(path, mode)
}

export async function appendToSafeFile(filePath: string, content: string, mode: number = 0o600): Promise<void> {
  await ensureNotSymlink(filePath)
  await appendFile(filePath, content, { mode })
}

export async function writeFileAtomic(filePath: string, content: string, options: WriteOptions = {}): Promise<void> {
  const mode = options.mode ?? 0o600
  await ensureNotSymlink(filePath)

  const tempPath = join(dirname(filePath), `.capgo-tmp-${randomBytes(8).toString('hex')}`)
  try {
    await writeFile(tempPath, content, { encoding: options.encoding ?? 'utf-8', mode })
    await rename(tempPath, filePath)
  }
  catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

export async function readSafeFile(filePath: string): Promise<string> {
  await ensureNotSymlink(filePath)
  return await readFile(filePath, 'utf-8')
}

