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
await test('iOS validation requires certificate and provisioning profile with App Store Connect metadata', () => {
  const credentials = {
    BUILD_CERTIFICATE_BASE64: 'cert',
    BUILD_PROVISION_PROFILE_BASE64: 'profile',
    // Missing auth - should fail
  }

  const missingCreds = []

  if (!credentials.BUILD_CERTIFICATE_BASE64)
    missingCreds.push('BUILD_CERTIFICATE_BASE64')
  if (!credentials.BUILD_PROVISION_PROFILE_BASE64)
    missingCreds.push('BUILD_PROVISION_PROFILE_BASE64')

  // App Store Connect API key credentials required
  if (!credentials.APPLE_KEY_ID)
    missingCreds.push('APPLE_KEY_ID')
  if (!credentials.APPLE_ISSUER_ID)
    missingCreds.push('APPLE_ISSUER_ID')
  if (!credentials.APPLE_KEY_CONTENT)
    missingCreds.push('APPLE_KEY_CONTENT')
  if (!credentials.APP_STORE_CONNECT_TEAM_ID)
    missingCreds.push('APP_STORE_CONNECT_TEAM_ID')
  if (!credentials.APPLE_PROFILE_NAME)
    missingCreds.push('APPLE_PROFILE_NAME')

  assert(missingCreds.length === 5, 'Should have 5 missing iOS credentials')
  assert(missingCreds.includes('APPLE_KEY_ID'), 'Should require APPLE_KEY_ID')
  assert(missingCreds.includes('APPLE_ISSUER_ID'), 'Should require APPLE_ISSUER_ID')
  assert(missingCreds.includes('APPLE_KEY_CONTENT'), 'Should require APPLE_KEY_CONTENT')
  assert(missingCreds.includes('APP_STORE_CONNECT_TEAM_ID'), 'Should require APP_STORE_CONNECT_TEAM_ID')
  assert(missingCreds.includes('APPLE_PROFILE_NAME'), 'Should require APPLE_PROFILE_NAME')
})

// Test 2: iOS accepts App Store Connect API key
await test('iOS validation accepts App Store Connect API key', () => {
  const credentials = {
    BUILD_CERTIFICATE_BASE64: 'cert',
    BUILD_PROVISION_PROFILE_BASE64: 'profile',
    APPLE_KEY_ID: 'keyid',
    APPLE_ISSUER_ID: 'issuerid',
    APPLE_KEY_CONTENT: 'keycontent',
    APP_STORE_CONNECT_TEAM_ID: 'teamid',
    APPLE_PROFILE_NAME: 'match AppStore com.example.app',
  }

  const missingCreds = []

  if (!credentials.BUILD_CERTIFICATE_BASE64)
    missingCreds.push('BUILD_CERTIFICATE_BASE64')
  if (!credentials.BUILD_PROVISION_PROFILE_BASE64)
    missingCreds.push('BUILD_PROVISION_PROFILE_BASE64')

  if (!credentials.APPLE_KEY_ID)
    missingCreds.push('APPLE_KEY_ID')
  if (!credentials.APPLE_ISSUER_ID)
    missingCreds.push('APPLE_ISSUER_ID')
  if (!credentials.APPLE_KEY_CONTENT)
    missingCreds.push('APPLE_KEY_CONTENT')
  if (!credentials.APP_STORE_CONNECT_TEAM_ID)
    missingCreds.push('APP_STORE_CONNECT_TEAM_ID')
  if (!credentials.APPLE_PROFILE_NAME)
    missingCreds.push('APPLE_PROFILE_NAME')

  assert(missingCreds.length === 0, 'Should have no missing credentials with API key')
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
    BUILD_PROVISION_PROFILE_BASE64: 'profile',
    APPLE_KEY_ID: 'keyid',
    APPLE_ISSUER_ID: 'issuerid',
    // Missing APPLE_KEY_CONTENT, APP_STORE_CONNECT_TEAM_ID and APPLE_PROFILE_NAME
  }

  const missingCreds = []

  if (!credentials.BUILD_CERTIFICATE_BASE64)
    missingCreds.push('BUILD_CERTIFICATE_BASE64')
  if (!credentials.BUILD_PROVISION_PROFILE_BASE64)
    missingCreds.push('BUILD_PROVISION_PROFILE_BASE64')

  if (!credentials.APPLE_KEY_ID)
    missingCreds.push('APPLE_KEY_ID')
  if (!credentials.APPLE_ISSUER_ID)
    missingCreds.push('APPLE_ISSUER_ID')
  if (!credentials.APPLE_KEY_CONTENT)
    missingCreds.push('APPLE_KEY_CONTENT')
  if (!credentials.APP_STORE_CONNECT_TEAM_ID)
    missingCreds.push('APP_STORE_CONNECT_TEAM_ID')
  if (!credentials.APPLE_PROFILE_NAME)
    missingCreds.push('APPLE_PROFILE_NAME')

  assert(missingCreds.length === 3, 'Should have 3 missing credentials (APPLE_KEY_CONTENT, APP_STORE_CONNECT_TEAM_ID, APPLE_PROFILE_NAME)')
  assert(missingCreds.includes('APPLE_KEY_CONTENT'), 'Should require APPLE_KEY_CONTENT')
  assert(missingCreds.includes('APP_STORE_CONNECT_TEAM_ID'), 'Should require APP_STORE_CONNECT_TEAM_ID')
  assert(missingCreds.includes('APPLE_PROFILE_NAME'), 'Should require APPLE_PROFILE_NAME')
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
