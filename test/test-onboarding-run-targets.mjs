#!/usr/bin/env node

import assert from 'node:assert/strict'
import {
  getPhysicalIosRunTargets,
  getSimulatorIosRunTargets,
  parseCapacitorRunTargetList,
} from '../src/init/command.ts'

let failures = 0

function test(name, fn) {
  try {
    fn()
    console.log(`✓ ${name}`)
  }
  catch (error) {
    failures += 1
    console.error(`❌ ${name}`)
    console.error(error)
  }
}

test('parses Capacitor run target list output', () => {
  const targets = parseCapacitorRunTargetList(JSON.stringify([
    { name: 'Martin iPhone', api: 'iOS 26.0', id: '00008110-001A' },
    { name: 'iPhone 17 (simulator)', api: 'iOS 26.0', id: 'A-B-C-D' },
    { name: '', api: 'iOS 26.0', id: 'FALLBACK-ID' },
    { name: 'Missing ID', api: 'iOS 26.0' },
    { name: 'Unresolved iPhone', api: 'iOS 26.0', id: '?' },
  ]))

  assert.deepEqual(targets, [
    { name: 'Martin iPhone', api: 'iOS 26.0', id: '00008110-001A' },
    { name: 'iPhone 17 (simulator)', api: 'iOS 26.0', id: 'A-B-C-D' },
    { name: 'FALLBACK-ID', api: 'iOS 26.0', id: 'FALLBACK-ID' },
  ])
})

test('returns an empty target list for malformed Capacitor output', () => {
  assert.deepEqual(parseCapacitorRunTargetList(''), [])
  assert.deepEqual(parseCapacitorRunTargetList('not json'), [])
  assert.deepEqual(parseCapacitorRunTargetList(JSON.stringify({ name: 'Not a list' })), [])
})

test('filters physical iOS devices from simulator targets', () => {
  const physicalTargets = getPhysicalIosRunTargets([
    { name: 'Martin iPhone', api: 'iOS 26.0', id: 'device-1' },
    { name: 'iPad Pro (simulator)', api: 'iOS 26.0', id: 'sim-1' },
    { name: 'QA iPad', api: 'iOS 25.5', id: 'device-2' },
  ])

  assert.deepEqual(physicalTargets, [
    { name: 'Martin iPhone', api: 'iOS 26.0', id: 'device-1' },
    { name: 'QA iPad', api: 'iOS 25.5', id: 'device-2' },
  ])
})

test('filters iOS Simulator targets from physical devices', () => {
  const simulatorTargets = getSimulatorIosRunTargets([
    { name: 'Martin iPhone', api: 'iOS 26.0', id: 'device-1' },
    { name: 'iPad Pro (simulator)', api: 'iOS 26.0', id: 'sim-1' },
    { name: 'iPhone 17 (simulator)', api: 'iOS 26.0', id: 'sim-2' },
  ])

  assert.deepEqual(simulatorTargets, [
    { name: 'iPad Pro (simulator)', api: 'iOS 26.0', id: 'sim-1' },
    { name: 'iPhone 17 (simulator)', api: 'iOS 26.0', id: 'sim-2' },
  ])
})

if (failures > 0) {
  console.error(`\n❌ ${failures} onboarding run target test(s) failed`)
  process.exit(1)
}

console.log('\n✅ Onboarding run target handling works')
