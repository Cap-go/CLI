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

// Test 1: iOS requires minimum credentials
await test('iOS validation requires certificate, password, and provisioning profile', () => {
  const credentials = {
    BUILD_CERTIFICATE_BASE64: 'cert',
    P12_PASSWORD: 'pass',
    BUILD_PROVISION_PROFILE_BASE64: 'profile',
    // Missing auth - should fail
  }

  const missingCreds = []

  if (!credentials.BUILD_CERTIFICATE_BASE64)
    missingCreds.push('BUILD_CERTIFICATE_BASE64')
  if (!credentials.P12_PASSWORD)
    missingCreds.push('P12_PASSWORD')
  if (!credentials.BUILD_PROVISION_PROFILE_BASE64)
    missingCreds.push('BUILD_PROVISION_PROFILE_BASE64')

  // Either App Store Connect API key OR Apple ID credentials required
  const hasApiKey = credentials.APPLE_KEY_ID
    && credentials.APPLE_ISSUER_ID
    && credentials.APPLE_KEY_CONTENT
    && credentials.APP_STORE_CONNECT_TEAM_ID

  const hasAppleId = credentials.APPLE_ID
    && credentials.APPLE_APP_SPECIFIC_PASSWORD

  if (!hasApiKey && !hasAppleId) {
    missingCreds.push('Auth credentials')
  }

  assert(missingCreds.length === 1, 'Should have exactly 1 missing item (auth)')
  assert(missingCreds[0] === 'Auth credentials', 'Should require auth credentials')
})

// Test 2: iOS accepts App Store Connect API key
await test('iOS validation accepts App Store Connect API key', () => {
  const credentials = {
    BUILD_CERTIFICATE_BASE64: 'cert',
    P12_PASSWORD: 'pass',
    BUILD_PROVISION_PROFILE_BASE64: 'profile',
    APPLE_KEY_ID: 'keyid',
    APPLE_ISSUER_ID: 'issuerid',
    APPLE_KEY_CONTENT: 'keycontent',
    APP_STORE_CONNECT_TEAM_ID: 'teamid',
  }

  const missingCreds = []

  if (!credentials.BUILD_CERTIFICATE_BASE64)
    missingCreds.push('BUILD_CERTIFICATE_BASE64')
  if (!credentials.P12_PASSWORD)
    missingCreds.push('P12_PASSWORD')
  if (!credentials.BUILD_PROVISION_PROFILE_BASE64)
    missingCreds.push('BUILD_PROVISION_PROFILE_BASE64')

  const hasApiKey = credentials.APPLE_KEY_ID
    && credentials.APPLE_ISSUER_ID
    && credentials.APPLE_KEY_CONTENT
    && credentials.APP_STORE_CONNECT_TEAM_ID

  const hasAppleId = credentials.APPLE_ID
    && credentials.APPLE_APP_SPECIFIC_PASSWORD

  if (!hasApiKey && !hasAppleId) {
    missingCreds.push('Auth credentials')
  }

  assert(missingCreds.length === 0, 'Should have no missing credentials with API key')
})

// Test 3: iOS accepts Apple ID credentials
await test('iOS validation accepts Apple ID credentials', () => {
  const credentials = {
    BUILD_CERTIFICATE_BASE64: 'cert',
    P12_PASSWORD: 'pass',
    BUILD_PROVISION_PROFILE_BASE64: 'profile',
    APPLE_ID: 'test@example.com',
    APPLE_APP_SPECIFIC_PASSWORD: 'apppass',
  }

  const missingCreds = []

  if (!credentials.BUILD_CERTIFICATE_BASE64)
    missingCreds.push('BUILD_CERTIFICATE_BASE64')
  if (!credentials.P12_PASSWORD)
    missingCreds.push('P12_PASSWORD')
  if (!credentials.BUILD_PROVISION_PROFILE_BASE64)
    missingCreds.push('BUILD_PROVISION_PROFILE_BASE64')

  const hasApiKey = credentials.APPLE_KEY_ID
    && credentials.APPLE_ISSUER_ID
    && credentials.APPLE_KEY_CONTENT
    && credentials.APP_STORE_CONNECT_TEAM_ID

  const hasAppleId = credentials.APPLE_ID
    && credentials.APPLE_APP_SPECIFIC_PASSWORD

  if (!hasApiKey && !hasAppleId) {
    missingCreds.push('Auth credentials')
  }

  assert(missingCreds.length === 0, 'Should have no missing credentials with Apple ID')
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

// Test 7: iOS fails with partial API key
await test('iOS validation fails with incomplete API key credentials', () => {
  const credentials = {
    BUILD_CERTIFICATE_BASE64: 'cert',
    P12_PASSWORD: 'pass',
    BUILD_PROVISION_PROFILE_BASE64: 'profile',
    APPLE_KEY_ID: 'keyid',
    APPLE_ISSUER_ID: 'issuerid',
    // Missing APPLE_KEY_CONTENT and APP_STORE_CONNECT_TEAM_ID
  }

  const missingCreds = []

  if (!credentials.BUILD_CERTIFICATE_BASE64)
    missingCreds.push('BUILD_CERTIFICATE_BASE64')
  if (!credentials.P12_PASSWORD)
    missingCreds.push('P12_PASSWORD')
  if (!credentials.BUILD_PROVISION_PROFILE_BASE64)
    missingCreds.push('BUILD_PROVISION_PROFILE_BASE64')

  const hasApiKey = credentials.APPLE_KEY_ID
    && credentials.APPLE_ISSUER_ID
    && credentials.APPLE_KEY_CONTENT
    && credentials.APP_STORE_CONNECT_TEAM_ID

  const hasAppleId = credentials.APPLE_ID
    && credentials.APPLE_APP_SPECIFIC_PASSWORD

  if (!hasApiKey && !hasAppleId) {
    missingCreds.push('Auth credentials')
  }

  assert(missingCreds.length === 1, 'Should have missing auth credentials')
  assert(!hasApiKey, 'Should not accept partial API key')
})

// Test 8: iOS fails with partial Apple ID
await test('iOS validation fails with incomplete Apple ID credentials', () => {
  const credentials = {
    BUILD_CERTIFICATE_BASE64: 'cert',
    P12_PASSWORD: 'pass',
    BUILD_PROVISION_PROFILE_BASE64: 'profile',
    APPLE_ID: 'test@example.com',
    // Missing APPLE_APP_SPECIFIC_PASSWORD
  }

  const missingCreds = []

  if (!credentials.BUILD_CERTIFICATE_BASE64)
    missingCreds.push('BUILD_CERTIFICATE_BASE64')
  if (!credentials.P12_PASSWORD)
    missingCreds.push('P12_PASSWORD')
  if (!credentials.BUILD_PROVISION_PROFILE_BASE64)
    missingCreds.push('BUILD_PROVISION_PROFILE_BASE64')

  const hasApiKey = credentials.APPLE_KEY_ID
    && credentials.APPLE_ISSUER_ID
    && credentials.APPLE_KEY_CONTENT
    && credentials.APP_STORE_CONNECT_TEAM_ID

  const hasAppleId = credentials.APPLE_ID
    && credentials.APPLE_APP_SPECIFIC_PASSWORD

  if (!hasApiKey && !hasAppleId) {
    missingCreds.push('Auth credentials')
  }

  assert(missingCreds.length === 1, 'Should have missing auth credentials')
  assert(!hasAppleId, 'Should not accept partial Apple ID')
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
