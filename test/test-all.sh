#!/bin/bash
set -e

echo "🧪 Running complete test suite..."
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 1: Bundle Integrity"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
/Users/martindonadieu/.bun/bin/bun run test/test-bundle.mjs
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 2: Functional Tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
/Users/martindonadieu/.bun/bin/bun run test/test-functional.mjs
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 3: Semver Validation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
/Users/martindonadieu/.bun/bin/bun run test/test-semver-validation.mjs
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 4: Version Edge Cases (1.5.00 etc)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
/Users/martindonadieu/.bun/bin/bun run test/test-version-validation.mjs
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 5: regexSemver Validation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
/Users/martindonadieu/.bun/bin/bun run test/test-regex-validation.mjs
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 6: Upload Validation Integration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
/Users/martindonadieu/.bun/bin/bun run test/test-upload-validation.mjs
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ ALL TESTS PASSED!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Summary:"
echo "   ✓ Bundle integrity verified"
echo "   ✓ @capacitor/cli works with stubbed semver"
echo "   ✓ @std/semver validation works correctly"
echo "   ✓ regexSemver (upload.ts) rejects malformed versions"
echo "   ✓ Upload validation blocks versions like 1.5.00"
echo "   ✓ No unused dependencies in bundle"
echo ""
echo "🎉 Bundle optimization complete and validated!"
