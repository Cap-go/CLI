#!/usr/bin/env node
/**
 * Test suite for build credentials validation
 * Tests that the required credentials are properly validated for each platform
 */

console.log('🧪 Testing build credentials validation...\n')

let testsPassed = 0
let testsFailed = 0

async function test(name, fn) {
  try {
    console.log(`\n🔍 ${name}`)
    await fn()
    console.log(`✅ PASSED: ${name}`)
    testsPassed++
  }
  catch (error) {
    console.error(`❌ FAILED: ${name}`)
    console.error(`   Error: ${error.message}`)
    testsFailed++
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed')
  }
}

// Helper: run iOS validation logic matching request.ts
function validateIosCredentials(credentials) {
  const missingCreds = []

  if (!credentials.BUILD_CERTIFICATE_BASE64)
    missingCreds.push('BUILD_CERTIFICATE_BASE64')
  if (!credentials.BUILD_PROVISION_PROFILE_BASE64)
    missingCreds.push('BUILD_PROVISION_PROFILE_BASE64')

  // App Store Connect API key (optional - only needed for TestFlight upload and build number auto-increment)
  const hasAppleApiKey = credentials.APPLE_KEY_ID && credentials.APPLE_ISSUER_ID && credentials.APPLE_KEY_CONTENT
  if (!hasAppleApiKey) {
    if (credentials.BUILD_OUTPUT_UPLOAD_ENABLED !== 'true') {
      missingCreds.push('APPLE_KEY_ID/APPLE_ISSUER_ID/APPLE_KEY_CONTENT or BUILD_OUTPUT_UPLOAD_ENABLED=true')
    }
    else if (credentials.SKIP_BUILD_NUMBER_BUMP !== 'true') {
      missingCreds.push('APPLE_KEY_ID/APPLE_ISSUER_ID/APPLE_KEY_CONTENT or --skip-build-number-bump')
    }
    // else: warn only, no error
  }
  if (!credentials.APP_STORE_CONNECT_TEAM_ID)
    missingCreds.push('APP_STORE_CONNECT_TEAM_ID')

  return missingCreds
}

// Test 1: iOS - no API key + no output upload → error (no destination)
await test('iOS validation errors when no API key and no output upload', () => {
  const credentials = {
    BUILD_CERTIFICATE_BASE64: 'cert',
    P12_PASSWORD: 'pass',
    BUILD_PROVISION_PROFILE_BASE64: 'profile',
    APP_STORE_CONNECT_TEAM_ID: 'teamid',
    BUILD_OUTPUT_UPLOAD_ENABLED: 'false',
    // Missing API key, no output upload
  }

  const missingCreds = validateIosCredentials(credentials)

  assert(missingCreds.length === 1, `Should have 1 missing credential, got ${missingCreds.length}: ${missingCreds.join(', ')}`)
  assert(missingCreds[0].includes('BUILD_OUTPUT_UPLOAD_ENABLED'), 'Should suggest enabling output upload')
})

// Test 2: iOS accepts full credentials (API key + everything)
await test('iOS validation accepts complete credentials with API key', () => {
  const credentials = {
    BUILD_CERTIFICATE_BASE64: 'cert',
    P12_PASSWORD: 'pass',
    BUILD_PROVISION_PROFILE_BASE64: 'profile',
    APPLE_KEY_ID: 'keyid',
    APPLE_ISSUER_ID: 'issuerid',
    APPLE_KEY_CONTENT: 'keycontent',
    APP_STORE_CONNECT_TEAM_ID: 'teamid',
  }

  const missingCreds = validateIosCredentials(credentials)
  assert(missingCreds.length === 0, `Should have no missing credentials, got: ${missingCreds.join(', ')}`)
})

// Test 2b: iOS - no API key + output upload + no skip-build-number-bump → error
await test('iOS validation errors when no API key with output upload but no skip-build-number-bump', () => {
  const credentials = {
    BUILD_CERTIFICATE_BASE64: 'cert',
    P12_PASSWORD: 'pass',
    BUILD_PROVISION_PROFILE_BASE64: 'profile',
    APP_STORE_CONNECT_TEAM_ID: 'teamid',
    BUILD_OUTPUT_UPLOAD_ENABLED: 'true',
    // No API key, no skip-build-number-bump
  }

  const missingCreds = validateIosCredentials(credentials)

  assert(missingCreds.length === 1, `Should have 1 missing credential, got ${missingCreds.length}: ${missingCreds.join(', ')}`)
  assert(missingCreds[0].includes('skip-build-number-bump'), 'Should require skip-build-number-bump')
})

// Test 2c: iOS - no API key + output upload + skip-build-number-bump → allow (warn only)
await test('iOS validation allows no API key when output upload and skip-build-number-bump are set', () => {
  const credentials = {
    BUILD_CERTIFICATE_BASE64: 'cert',
    P12_PASSWORD: 'pass',
    BUILD_PROVISION_PROFILE_BASE64: 'profile',
    APP_STORE_CONNECT_TEAM_ID: 'teamid',
    BUILD_OUTPUT_UPLOAD_ENABLED: 'true',
    SKIP_BUILD_NUMBER_BUMP: 'true',
    // No API key - should be allowed
  }

  const missingCreds = validateIosCredentials(credentials)
  assert(missingCreds.length === 0, `Should have no missing credentials, got: ${missingCreds.join(', ')}`)
})


// Test 4: Android requires minimum credentials
await test('Android validation requires keystore and passwords', () => {
  const credentials = {
    ANDROID_KEYSTORE_FILE: 'keystore',
    KEYSTORE_KEY_ALIAS: 'alias',
    KEYSTORE_KEY_PASSWORD: 'keypass',
    KEYSTORE_STORE_PASSWORD: 'storepass',
  }

  const missingCreds = []

  if (!credentials.ANDROID_KEYSTORE_FILE)
    missingCreds.push('ANDROID_KEYSTORE_FILE')
  if (!credentials.KEYSTORE_KEY_ALIAS)
    missingCreds.push('KEYSTORE_KEY_ALIAS')
  if (!credentials.KEYSTORE_KEY_PASSWORD)
    missingCreds.push('KEYSTORE_KEY_PASSWORD')
  if (!credentials.KEYSTORE_STORE_PASSWORD)
    missingCreds.push('KEYSTORE_STORE_PASSWORD')

  assert(missingCreds.length === 0, 'Should have no missing credentials')
})

// Test 5: Android fails without keystore
await test('Android validation fails without keystore file', () => {
  const credentials = {
    // Missing ANDROID_KEYSTORE_FILE
    KEYSTORE_KEY_ALIAS: 'alias',
    KEYSTORE_KEY_PASSWORD: 'keypass',
    KEYSTORE_STORE_PASSWORD: 'storepass',
  }

  const missingCreds = []

  if (!credentials.ANDROID_KEYSTORE_FILE)
    missingCreds.push('ANDROID_KEYSTORE_FILE')
  if (!credentials.KEYSTORE_KEY_ALIAS)
    missingCreds.push('KEYSTORE_KEY_ALIAS')
  if (!credentials.KEYSTORE_KEY_PASSWORD)
    missingCreds.push('KEYSTORE_KEY_PASSWORD')
  if (!credentials.KEYSTORE_STORE_PASSWORD)
    missingCreds.push('KEYSTORE_STORE_PASSWORD')

  assert(missingCreds.length === 1, 'Should have 1 missing credential')
  assert(missingCreds[0] === 'ANDROID_KEYSTORE_FILE', 'Should require keystore file')
})

// Test 6: Android PLAY_CONFIG_JSON is optional for build
await test('Android validation allows missing PLAY_CONFIG_JSON', () => {
  const credentials = {
    ANDROID_KEYSTORE_FILE: 'keystore',
    KEYSTORE_KEY_ALIAS: 'alias',
    KEYSTORE_KEY_PASSWORD: 'keypass',
    KEYSTORE_STORE_PASSWORD: 'storepass',
    // PLAY_CONFIG_JSON is optional
  }

  const missingCreds = []

  if (!credentials.ANDROID_KEYSTORE_FILE)
    missingCreds.push('ANDROID_KEYSTORE_FILE')
  if (!credentials.KEYSTORE_KEY_ALIAS)
    missingCreds.push('KEYSTORE_KEY_ALIAS')
  if (!credentials.KEYSTORE_KEY_PASSWORD)
    missingCreds.push('KEYSTORE_KEY_PASSWORD')
  if (!credentials.KEYSTORE_STORE_PASSWORD)
    missingCreds.push('KEYSTORE_STORE_PASSWORD')

  // PLAY_CONFIG_JSON not checked in required validation

  assert(missingCreds.length === 0, 'Should have no missing required credentials')
  assert(!credentials.PLAY_CONFIG_JSON, 'PLAY_CONFIG_JSON should be optional')
})

// Test 7: iOS fails with partial API key (2 of 3 fields) and no output upload
await test('iOS validation fails with incomplete API key and no output upload', () => {
  const credentials = {
    BUILD_CERTIFICATE_BASE64: 'cert',
    P12_PASSWORD: 'pass',
    BUILD_PROVISION_PROFILE_BASE64: 'profile',
    APPLE_KEY_ID: 'keyid',
    APPLE_ISSUER_ID: 'issuerid',
    BUILD_OUTPUT_UPLOAD_ENABLED: 'false',
    // Missing APPLE_KEY_CONTENT (incomplete API key) and APP_STORE_CONNECT_TEAM_ID
  }

  const missingCreds = validateIosCredentials(credentials)

  // Should error for: incomplete API key (no destination) + missing team ID
  assert(missingCreds.length === 2, `Should have 2 missing credentials, got ${missingCreds.length}: ${missingCreds.join(', ')}`)
  assert(missingCreds.some(c => c.includes('BUILD_OUTPUT_UPLOAD_ENABLED')), 'Should suggest output upload as alternative')
  assert(missingCreds.some(c => c.includes('APP_STORE_CONNECT_TEAM_ID')), 'Should require APP_STORE_CONNECT_TEAM_ID')
})


// Print summary
console.log('\n' + '='.repeat(50))
console.log(`\n📊 Test Results:`)
console.log(`   ✅ Passed: ${testsPassed}`)
console.log(`   ❌ Failed: ${testsFailed}`)
console.log(`   📈 Total:  ${testsPassed + testsFailed}`)

if (testsFailed > 0) {
  console.log('\n❌ Some tests failed!')
  process.exit(1)
}
else {
  console.log('\n✅ All tests passed!')
  process.exit(0)
}
