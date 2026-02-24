#!/usr/bin/env node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'

import { shouldIncludeFile, zipDirectory } from '../src/build/request.ts'

async function t(name, fn) {
  try {
    await fn()
    process.stdout.write(`✅ ${name}\n`)
  }
  catch (error) {
    process.stderr.write(`❌ ${error instanceof Error ? error.message : String(error)}\n`)
    throw error
  }
}

function writeFile(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf-8')
}

const nativeDeps = { packages: new Set(['@capacitor/app']), usesSPM: false, usesCocoaPods: true }

await t('should include package metadata for @capacitor dependencies in zip filter', () => {
  assert.equal(
    shouldIncludeFile('node_modules/@capacitor/app/package.json', 'ios', nativeDeps, 'ios'),
    true,
  )
  assert.equal(
    shouldIncludeFile('node_modules/@capacitor/app/README.md', 'ios', nativeDeps, 'ios'),
    false,
  )
  assert.equal(
    shouldIncludeFile('node_modules/@capacitor/app/ios/App.swift', 'ios', nativeDeps, 'ios'),
    true,
  )
})

await t('generated build zip includes @capacitor plugin package.json for CocoaPods path resolution', async () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'capgo-build-zip-filter-'))
  const zipPath = join(testRoot, 'build.zip')

  try {
    writeFile(
      join(testRoot, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@capacitor/core': '^6.0.0',
          '@capacitor/app': '^6.0.0',
        },
      }, null, 2),
    )

    writeFile(
      join(testRoot, 'capacitor.config.json'),
      JSON.stringify({
        appId: 'com.example.app',
        appName: 'Example',
        webDir: 'www',
      }, null, 2),
    )

    writeFile(
      join(testRoot, 'ios', 'App', 'Podfile'),
      "platform :ios, '14.0'\npod '@capacitor/app', :path => '../../node_modules/@capacitor/app'\n",
    )

    writeFile(
      join(testRoot, 'ios', 'App', 'Podfile.lock'),
      'PODFILE: ["/node_modules/@capacitor/app"]\n',
    )

    writeFile(join(testRoot, 'www', 'index.html'), '<!doctype html><html></html>')
    writeFile(
      join(testRoot, 'node_modules', '@capacitor', 'app', 'package.json'),
      JSON.stringify({ name: '@capacitor/app', version: '6.0.0' }, null, 2),
    )
    writeFile(
      join(testRoot, 'node_modules', '@capacitor', 'app', 'CapacitorApp.podspec'),
      "Pod::Spec.new do |s|\n  s.name = 'CapacitorApp'\nend",
    )
    writeFile(
      join(testRoot, 'node_modules', '@capacitor', 'app', 'ios', 'Plugin.swift'),
      '// iOS source file',
    )
    writeFile(
      join(testRoot, 'node_modules', '@capacitor', 'app', 'README.md'),
      'should be filtered out',
    )
    writeFile(join(testRoot, 'node_modules', '@capacitor', 'app', 'android', 'build.gradle'), '')

    await zipDirectory(testRoot, zipPath, 'ios', {
      ios: { path: 'ios' },
    })

    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries().map(entry => entry.entryName).sort()

    assert.ok(entries.includes('node_modules/@capacitor/app/package.json'), 'missing plugin package.json in zip')
    assert.ok(entries.includes('node_modules/@capacitor/app/CapacitorApp.podspec'), 'missing plugin podspec in zip')
    assert.ok(entries.includes('node_modules/@capacitor/app/ios/Plugin.swift'), 'missing plugin ios code in zip')
    assert.ok(!entries.includes('node_modules/@capacitor/app/README.md'), 'non-native plugin file was not filtered')
    assert.ok(entries.includes('ios/App/Podfile'), 'native platform folder not included')
    assert.ok(entries.includes('package.json'), 'root package.json not included')
  }
  finally {
    rmSync(testRoot, { recursive: true, force: true })
  }
})

await t('generated build zip includes Capacitor plugin for ios Podfile at platform root', async () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'capgo-build-zip-filter-'))
  const zipPath = join(testRoot, 'build.zip')

  try {
    writeFile(
      join(testRoot, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@capacitor/core': '^6.0.0',
          '@capacitor/app': '^6.0.0',
        },
      }, null, 2),
    )

    writeFile(
      join(testRoot, 'capacitor.config.json'),
      JSON.stringify({
        ios: {
          path: 'apps/native/ios',
        },
        appId: 'com.example.app',
        appName: 'Example',
      }, null, 2),
    )

    writeFile(
      join(testRoot, 'apps/native/ios/Podfile'),
      "pod 'CapacitorApp', :path => '../../../node_modules/@capacitor/app'\n",
    )

    writeFile(join(testRoot, 'www', 'index.html'), '<!doctype html><html></html>')
    writeFile(
      join(testRoot, 'node_modules', '@capacitor', 'app', 'package.json'),
      JSON.stringify({ name: '@capacitor/app', version: '6.0.0' }, null, 2),
    )
    writeFile(
      join(testRoot, 'node_modules', '@capacitor', 'app', 'CapacitorApp.podspec'),
      "Pod::Spec.new do |s|\n  s.name = 'CapacitorApp'\nend",
    )

    await zipDirectory(testRoot, zipPath, 'ios', {
      ios: {
        path: 'apps/native/ios',
      },
    })

    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries().map(entry => entry.entryName).sort()

    assert.ok(entries.includes('node_modules/@capacitor/app/package.json'), 'missing plugin package.json in zip')
    assert.ok(entries.includes('apps/native/ios/Podfile'), 'root platform podfile not included')
    assert.ok(!entries.includes('apps/native/ios/App/Podfile'), 'unexpected nested podfile was included')
  }
  finally {
    rmSync(testRoot, { recursive: true, force: true })
  }
})

await t('generated build zip supports nested Capacitor Podfile paths in monorepo layouts', async () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'capgo-build-zip-filter-'))
  const zipPath = join(testRoot, 'build.zip')

  try {
    writeFile(
      join(testRoot, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@capacitor/core': '^6.0.0',
          '@capacitor/app': '^6.0.0',
        },
      }, null, 2),
    )

    writeFile(
      join(testRoot, 'capacitor.config.json'),
      JSON.stringify({
        ios: {
          path: 'apps/native/ios',
        },
        appId: 'com.example.app',
        appName: 'Example',
      }, null, 2),
    )

    writeFile(
      join(testRoot, 'apps/native/ios/App/Podfile'),
      "platform :ios, '14.0'\npod 'CapacitorApp', :path => '../../../node_modules/@capacitor/app'\n",
    )

    writeFile(
      join(testRoot, 'apps/native/ios/App/Podfile.lock'),
      'PODFILE: ["/node_modules/@capacitor/app"]\n',
    )

    writeFile(join(testRoot, 'www', 'index.html'), '<!doctype html><html></html>')
    writeFile(
      join(testRoot, 'node_modules', '@capacitor', 'app', 'package.json'),
      JSON.stringify({ name: '@capacitor/app', version: '6.0.0' }, null, 2),
    )
    writeFile(
      join(testRoot, 'node_modules', '@capacitor', 'app', 'CapacitorApp.podspec'),
      "Pod::Spec.new do |s|\n  s.name = 'CapacitorApp'\nend",
    )

    await zipDirectory(testRoot, zipPath, 'ios', {
      ios: {
        path: 'apps/native/ios',
      },
    })

    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries().map(entry => entry.entryName).sort()

    assert.ok(entries.includes('apps/native/ios/App/Podfile'), 'native platform podfile not included')
    assert.ok(entries.includes('node_modules/@capacitor/app/package.json'), 'missing plugin package.json in zip')
    assert.ok(entries.includes('node_modules/@capacitor/app/CapacitorApp.podspec'), 'missing plugin podspec in zip')
    assert.ok(!entries.includes('apps/native/ios/Podfile.lock'), 'unexpected root lockfile was included')
  }
  finally {
    rmSync(testRoot, { recursive: true, force: true })
  }
})

await t('generated build zip includes SPM and CocoaPods metadata when both managers are configured', async () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'capgo-build-zip-filter-'))
  const zipPath = join(testRoot, 'build.zip')

  try {
    writeFile(
      join(testRoot, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@capacitor/core': '^6.0.0',
          '@capacitor/app': '^6.0.0',
        },
      }, null, 2),
    )

    writeFile(
      join(testRoot, 'capacitor.config.json'),
      JSON.stringify({
        ios: {
          path: 'ios',
        },
        appId: 'com.example.app',
        appName: 'Example',
      }, null, 2),
    )

    writeFile(
      join(testRoot, 'ios/App/CapApp-SPM/Package.swift'),
      'let package = Package(name: "CapAppSPM", dependencies: [.package(name: "CapacitorApp", path: "../../../node_modules/@capacitor/app")])\n',
    )

    writeFile(
      join(testRoot, 'ios/App/Podfile'),
      "pod 'CapacitorApp', :path => '../../node_modules/@capacitor/app'\n",
    )

    writeFile(
      join(testRoot, 'node_modules', '@capacitor', 'app', 'package.json'),
      JSON.stringify({ name: '@capacitor/app', version: '6.0.0' }, null, 2),
    )
    writeFile(
      join(testRoot, 'node_modules', '@capacitor', 'app', 'CapacitorApp.podspec'),
      "Pod::Spec.new do |s|\n  s.name = 'CapacitorApp'\nend",
    )
    writeFile(
      join(testRoot, 'node_modules', '@capacitor', 'app', 'Package.swift'),
      'let package = Package(name: "CapacitorApp")\n',
    )

    await zipDirectory(testRoot, zipPath, 'ios', {
      ios: {
        path: 'ios',
      },
    })

    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries().map(entry => entry.entryName).sort()

    assert.ok(entries.includes('node_modules/@capacitor/app/package.json'), 'missing plugin package.json in zip')
    assert.ok(entries.includes('node_modules/@capacitor/app/CapacitorApp.podspec'), 'missing plugin podspec in zip')
    assert.ok(entries.includes('node_modules/@capacitor/app/Package.swift'), 'missing plugin Package.swift in zip')
  }
  finally {
    rmSync(testRoot, { recursive: true, force: true })
  }
})
process.stdout.write('OK\n')
