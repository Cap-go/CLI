import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { findSignableTargets, findXcodeProject } from '../src/build/pbxproj-parser.ts'

function t(name, fn) {
  try {
    fn()
    process.stdout.write(`\u2713 ${name}\n`)
  }
  catch (e) {
    process.stderr.write(`\u2717 ${name}\n`)
    throw e
  }
}

const samplePbxproj = `// !$*UTF8*$!
{
  archiveVersion = 1;
  objectVersion = 56;
  objects = {
    13B07F861A680F5B00A75B9A /* App */ = {
      isa = PBXNativeTarget;
      buildConfigurationList = 13B07F931A680F5B00A75B9A;
      name = App;
      productName = App;
      productType = "com.apple.product-type.application";
    };
    AA11BB22CC33DD44 /* ShareExtension */ = {
      isa = PBXNativeTarget;
      buildConfigurationList = AA11BB22CC33DD55;
      name = ShareExtension;
      productName = ShareExtension;
      productType = "com.apple.product-type.app-extension";
    };
    FF00FF00FF00FF00 /* UnitTests */ = {
      isa = PBXNativeTarget;
      buildConfigurationList = FF00FF00FF00FF11;
      name = UnitTests;
      productName = UnitTests;
      productType = "com.apple.product-type.bundle.unit-test";
    };
    13B07F931A680F5B00A75B9A /* Build configuration list for App */ = {
      isa = XCConfigurationList;
      buildConfigurations = (
        13B07F941A680F5B00A75B9A,
      );
    };
    13B07F941A680F5B00A75B9A /* Release */ = {
      isa = XCBuildConfiguration;
      buildSettings = {
        PRODUCT_BUNDLE_IDENTIFIER = "com.example.myapp";
        INFOPLIST_FILE = App/Info.plist;
      };
      name = Release;
    };
    AA11BB22CC33DD55 /* Build configuration list for ShareExtension */ = {
      isa = XCConfigurationList;
      buildConfigurations = (
        AA11BB22CC33DD66,
      );
    };
    AA11BB22CC33DD66 /* Release */ = {
      isa = XCBuildConfiguration;
      buildSettings = {
        PRODUCT_BUNDLE_IDENTIFIER = "com.example.myapp.ShareExtension";
        INFOPLIST_FILE = ShareExtension/Info.plist;
      };
      name = Release;
    };
  };
  rootObject = 089C1665FE841187C02AAC07;
}`

t('finds app and extension targets, ignores unit-test target', () => {
  const targets = findSignableTargets(samplePbxproj)

  assert.equal(targets.length, 2)

  const app = targets.find(t => t.name === 'App')
  assert.ok(app, 'should find App target')
  assert.equal(app.bundleId, 'com.example.myapp')
  assert.equal(app.productType, 'com.apple.product-type.application')

  const ext = targets.find(t => t.name === 'ShareExtension')
  assert.ok(ext, 'should find ShareExtension target')
  assert.equal(ext.bundleId, 'com.example.myapp.ShareExtension')
  assert.equal(ext.productType, 'com.apple.product-type.app-extension')
})

t('returns empty array for empty content', () => {
  const targets = findSignableTargets('')
  assert.deepEqual(targets, [])
})

t('findXcodeProject finds .xcodeproj in ios/ subdirectory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pbx-test-'))
  const xcodeprojDir = join(dir, 'ios', 'MyApp.xcodeproj')
  mkdirSync(xcodeprojDir, { recursive: true })
  writeFileSync(join(xcodeprojDir, 'project.pbxproj'), 'fake content')

  const result = findXcodeProject(dir)
  assert.equal(result, join(xcodeprojDir, 'project.pbxproj'))

  rmSync(dir, { recursive: true })
})

t('findXcodeProject returns null when no .xcodeproj exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pbx-test-'))
  mkdirSync(join(dir, 'ios'), { recursive: true })

  const result = findXcodeProject(dir)
  assert.equal(result, null)

  rmSync(dir, { recursive: true })
})

process.stdout.write('OK\n')
