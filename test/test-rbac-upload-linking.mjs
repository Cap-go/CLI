#!/usr/bin/env bun

import { resolveVersionIdForChannelUpdate } from '../src/bundle/upload.ts'

console.log('🧪 Testing RBAC upload channel linking regression...\n')

function assert(condition, message) {
  if (!condition)
    throw new Error(message || 'Assertion failed')
}

async function test(name, fn) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  }
  catch (error) {
    console.error(`❌ ${name}`)
    console.error(`   ${error.message}`)
    process.exitCode = 1
  }
}

await test('prefers the upserted version id and skips all follow-up lookups', async () => {
  let fromCalls = 0
  let rpcCalls = 0

  const supabase = {
    from() {
      fromCalls++
      throw new Error('from() should not be called when version id is already known')
    },
    rpc() {
      rpcCalls++
      throw new Error('rpc() should not be called when version id is already known')
    },
  }

  const versionId = await resolveVersionIdForChannelUpdate(supabase, 'key', 'app', '1.2.3', 42)
  assert(versionId === 42, `expected 42, got ${versionId}`)
  assert(fromCalls === 0, `expected 0 table lookups, got ${fromCalls}`)
  assert(rpcCalls === 0, `expected 0 rpc calls, got ${rpcCalls}`)
})

await test('falls back to a direct app_versions lookup before the legacy rpc', async () => {
  let rpcCalls = 0

  const supabase = {
    from(table) {
      assert(table === 'app_versions', `unexpected table ${table}`)
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        single() {
          return Promise.resolve({ data: { id: 77 } })
        },
      }
    },
    rpc() {
      rpcCalls++
      return {
        single() {
          return Promise.resolve({ data: 99 })
        },
      }
    },
  }

  const versionId = await resolveVersionIdForChannelUpdate(supabase, 'key', 'app', '1.2.3')
  assert(versionId === 77, `expected 77, got ${versionId}`)
  assert(rpcCalls === 0, `expected rpc fallback to be skipped, got ${rpcCalls} calls`)
})

await test('still supports the legacy rpc fallback when the direct lookup cannot see the version row', async () => {
  let rpcCalls = 0

  const supabase = {
    from() {
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        single() {
          return Promise.resolve({ data: null })
        },
      }
    },
    rpc(name, params) {
      rpcCalls++
      assert(name === 'get_app_versions', `unexpected rpc ${name}`)
      assert(params.apikey === 'key', 'apikey should be forwarded to rpc fallback')
      return {
        single() {
          return Promise.resolve({ data: 105 })
        },
      }
    },
  }

  const versionId = await resolveVersionIdForChannelUpdate(supabase, 'key', 'app', '1.2.3')
  assert(versionId === 105, `expected 105, got ${versionId}`)
  assert(rpcCalls === 1, `expected 1 rpc call, got ${rpcCalls}`)
})
