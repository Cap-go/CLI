// src/build/onboarding/file-picker.ts
import { execFile } from 'node:child_process'
import { platform } from 'node:process'

/**
 * Returns true if we're on macOS and can use the native file picker.
 */
export function canUseFilePicker(): boolean {
  return platform === 'darwin'
}

/**
 * Open the macOS native file picker dialog filtered to .p8 files.
 * Returns the selected file path, or null if the user cancelled.
 * Non-blocking — uses async execFile so Ink spinners keep animating.
 */
export function openFilePicker(): Promise<string | null> {
  if (!canUseFilePicker())
    return Promise.resolve(null)

  return new Promise((resolve) => {
    execFile(
      'osascript',
      ['-e', 'POSIX path of (choose file of type {"p8"} with prompt "Select your .p8 API key file")'],
      { encoding: 'utf-8', timeout: 120000 },
      (err, stdout) => {
        if (err) {
          // User cancelled the dialog or osascript failed
          resolve(null)
          return
        }
        const path = stdout.trim()
        resolve(path || null)
      },
    )
  })
}
