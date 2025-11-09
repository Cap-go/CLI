#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'

console.log('🧪 Testing bundle integrity...\n')

// Test 1: Check if semver is in the bundle
console.log('1️⃣  Checking if semver package is excluded from bundle...')
const metaPath = './meta.json'
if (!existsSync(metaPath)) {
  console.error('❌ meta.json not found. Run build first.')
  process.exit(1)
}

const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
const inputs = Object.keys(meta.inputs)
const semverFiles = inputs.filter(f => f.includes('node_modules/semver/') && !f.includes('@std/semver'))

if (semverFiles.length > 0) {
  console.error(`❌ Found ${semverFiles.length} semver files in bundle:`)
  semverFiles.slice(0, 5).forEach(f => console.error(`   - ${f}`))
  if (semverFiles.length > 5) {
    console.error(`   ... and ${semverFiles.length - 5} more`)
  }
  process.exit(1)
}
else {
  console.log('✅ semver package successfully excluded from bundle')
}

// Test 2: Check bundle size
console.log('\n2️⃣  Checking bundle sizes...')
const cliSize = meta.outputs['dist/index.js'].bytes
const sdkPath = './dist/src/sdk.js'
const sdkSize = existsSync(sdkPath) ? readFileSync(sdkPath).length : 0
console.log(`   CLI bundle: ${(cliSize / 1024).toFixed(2)} KB`)
if (sdkSize > 0) {
  console.log(`   SDK bundle: ${(sdkSize / 1024).toFixed(2)} KB`)
  console.log(`   Total: ${((cliSize + sdkSize) / 1024).toFixed(2)} KB`)
}
else {
  console.log(`   Total: ${(cliSize / 1024).toFixed(2)} KB`)
}
console.log('✅ Bundle sizes calculated')

// Test 3: Check if @capacitor/cli is in bundle
console.log('\n3️⃣  Checking if @capacitor/cli dependencies are present...')
const capacitorFiles = inputs.filter(f => f.includes('@capacitor/cli'))
if (capacitorFiles.length === 0) {
  console.error('❌ @capacitor/cli not found in bundle - this might break functionality')
  process.exit(1)
}
else {
  console.log(`✅ Found ${capacitorFiles.length} @capacitor/cli files in bundle`)
}

// Test 4: Verify stub-semver namespace is used
console.log('\n4️⃣  Verifying semver stub is in place...')
const bundleContent = readFileSync('./dist/index.js', 'utf-8')
if (bundleContent.includes('Stub for semver package')) {
  console.log('✅ semver stub found in bundle')
}
else {
  console.warn('⚠️  semver stub comment not found - this is expected if minified')
}

// Test 5: Check for @std/semver (which we DO use)
console.log('\n5️⃣  Checking if @std/semver is present (we use this)...')
const stdSemverFiles = inputs.filter(f => f.includes('@std/semver'))
if (stdSemverFiles.length === 0) {
  console.error('❌ @std/semver not found - this will break version parsing!')
  process.exit(1)
}
else {
  console.log(`✅ Found ${stdSemverFiles.length} @std/semver files in bundle`)
}

// Test 6: Verify only type definitions in dist/src (except sdk.js)
console.log('\n6️⃣  Checking dist/src structure...')
const distSrcInputs = inputs.filter(f => f.startsWith('dist/src/'))
const jsFiles = distSrcInputs.filter(f => f.endsWith('.js') && !f.endsWith('sdk.js'))
if (jsFiles.length > 0) {
  console.warn(`⚠️  Found ${jsFiles.length} unexpected JS files in dist/src:`)
  jsFiles.slice(0, 3).forEach(f => console.warn(`   - ${f}`))
}
else {
  console.log('✅ No unexpected compiled JS files in dist/src')
}

console.log('\n✅ All bundle integrity tests passed!')
console.log('\n📊 Summary:')
console.log(`   - semver package: excluded ✓`)
console.log(`   - @std/semver: included ✓`)
console.log(`   - @capacitor/cli: included ✓`)
console.log(`   - Bundle size: ${((cliSize + sdkSize) / 1024).toFixed(0)} KB`)
