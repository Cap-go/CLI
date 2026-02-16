import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateIosUpdaterSync } from '../src/utils.ts'

function t(name, fn) {
  try {
    fn()
    process.stdout.write(`✓ ${name}\n`)
  }
  catch (e) {
    process.stderr.write(`✗ ${name}\n`)
    throw e
  }
}

function withTempProject(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'capgo-ios-sync-test-'))
  try {
    fn(dir)
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function write(root, relPath, content) {
  const fullPath = join(root, relPath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, content, 'utf-8')
}

t('valid iOS Podfile project with updater properly synced', () => {
  withTempProject((root) => {
    write(root, 'package.json', JSON.stringify({
      name: 'app',
      version: '1.0.0',
      dependencies: {
        '@capgo/capacitor-updater': '^8.0.0',
      },
    }))
    write(root, 'ios/App/Podfile', `pod 'CapgoCapacitorUpdater', :path => '../../node_modules/@capgo/capacitor-updater'`)
    write(root, 'ios/App/Podfile.lock', 'PODS:\n  - CapgoCapacitorUpdater')

    const result = validateIosUpdaterSync(root)
    assert.equal(result.shouldCheck, true)
    assert.equal(result.valid, true)
    assert.deepEqual(result.details, [])
  })
})

t('reports missing updater in dependency files (Podfile/Package.swift)', () => {
  withTempProject((root) => {
    write(root, 'package.json', JSON.stringify({
      name: 'app',
      version: '1.0.0',
      dependencies: {
        '@capgo/capacitor-updater': '^8.0.0',
      },
    }))
    write(root, 'ios/App/Podfile', `pod 'CapacitorApp', :path => '../../node_modules/@capacitor/app'`)
    write(root, 'ios/App/Podfile.lock', 'PODS:\n  - CapgoCapacitorUpdater')

    const result = validateIosUpdaterSync(root)
    assert.equal(result.shouldCheck, true)
    assert.equal(result.valid, false)
    assert.equal(result.details.some(detail => detail.includes('dependency files')), true)
  })
})

t('reports missing updater in native project outputs', () => {
  withTempProject((root) => {
    write(root, 'package.json', JSON.stringify({
      name: 'app',
      version: '1.0.0',
      dependencies: {
        '@capgo/capacitor-updater': '^8.0.0',
      },
    }))
    write(root, 'ios/App/Podfile', `pod 'CapgoCapacitorUpdater', :path => '../../node_modules/@capgo/capacitor-updater'`)

    const result = validateIosUpdaterSync(root)
    assert.equal(result.shouldCheck, true)
    assert.equal(result.valid, false)
    assert.equal(result.details.some(detail => detail.includes('native project outputs')), true)
  })
})

t('projects without iOS folder return shouldCheck=false', () => {
  withTempProject((root) => {
    write(root, 'package.json', JSON.stringify({
      name: 'app',
      version: '1.0.0',
      dependencies: {
        '@capgo/capacitor-updater': '^8.0.0',
      },
    }))

    const result = validateIosUpdaterSync(root)
    assert.equal(result.shouldCheck, false)
    assert.equal(result.valid, true)
    assert.deepEqual(result.details, [])
  })
})

t('projects with iOS but no updater signals return shouldCheck=false', () => {
  withTempProject((root) => {
    write(root, 'package.json', JSON.stringify({
      name: 'app',
      version: '1.0.0',
      dependencies: {
        '@capacitor/core': '^8.0.0',
      },
    }))
    write(root, 'ios/App/Podfile', `pod 'CapacitorApp', :path => '../../node_modules/@capacitor/app'`)

    const result = validateIosUpdaterSync(root)
    assert.equal(result.shouldCheck, false)
    assert.equal(result.valid, true)
    assert.deepEqual(result.details, [])
  })
})

t('missing package.json does not crash and still validates from iOS files', () => {
  withTempProject((root) => {
    write(root, 'ios/App/Podfile', `pod 'CapgoCapacitorUpdater', :path => '../../node_modules/@capgo/capacitor-updater'`)
    write(root, 'ios/App/Podfile.lock', 'PODS:\n  - CapgoCapacitorUpdater')

    const result = validateIosUpdaterSync(root)
    assert.equal(result.shouldCheck, true)
    assert.equal(result.valid, true)
    assert.deepEqual(result.details, [])
  })
})

t('corrupted package.json does not crash and still validates from iOS files', () => {
  withTempProject((root) => {
    write(root, 'package.json', '{ this is invalid json')
    write(root, 'ios/App/CapApp-SPM/Package.swift', '.package(name: "CapgoCapacitorUpdater", path: "../../../node_modules/@capgo/capacitor-updater")')
    write(root, 'ios/App/App.xcworkspace/xcshareddata/swiftpm/Package.resolved', '@capgo/capacitor-updater')

    const result = validateIosUpdaterSync(root)
    assert.equal(result.shouldCheck, true)
    assert.equal(result.valid, true)
    assert.deepEqual(result.details, [])
  })
})

process.stdout.write('OK\n')
