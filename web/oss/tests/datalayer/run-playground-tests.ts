#!/usr/bin/env tsx
/**
 * New Playground Test Runner
 *
 * Dedicated test runner for the new playground state architecture.
 * Useful for development and debugging of playground atoms.
 */

import {runNewPlaygroundTest} from "./test-newPlayground"

async function main() {
    console.log("🚀 Running New Playground State Tests...\n")

    try {
        const results = await runNewPlaygroundTest()

        console.log("\n" + "=".repeat(60))
        console.log("🎯 NEW PLAYGROUND TEST RESULTS")
        console.log("=".repeat(60))
        console.log(`✅ Passed: ${results.passedCount}`)
        console.log(`❌ Failed: ${results.failedCount}`)
        console.log(`📊 Total: ${results.totalCount}`)
        console.log(
            `📈 Success Rate: ${((results.passedCount / results.totalCount) * 100).toFixed(1)}%`,
        )

        if (results.metrics && Object.keys(results.metrics).length > 0) {
            console.log("\n📊 Performance Metrics:")
            Object.entries(results.metrics).forEach(([key, value]) => {
                if (typeof value === "number") {
                    if (key.includes("Time")) {
                        console.log(`  ${key}: ${value.toFixed(2)}ms`)
                    } else if (key.includes("memory") || key.includes("Size")) {
                        console.log(`  ${key}: ${(value / 1024).toFixed(2)}KB`)
                    } else {
                        console.log(`  ${key}: ${value}`)
                    }
                }
            })
        }

        if (results.failedCount > 0) {
            console.log("\n❌ Failed Tests:")
            results.results.forEach((result) => {
                if (!result.passed) {
                    console.log(`  - ${result.description}: ${result.details}`)
                }
            })

            console.log("\n💡 Tips for debugging:")
            console.log(
                "  1. Check that all imports are correct after moving to /state/newPlayground/",
            )
            console.log("  2. Verify metadata utilities are properly integrated")
            console.log("  3. Ensure existing utility functions are being reused")
            console.log("  4. Check that derived atoms are updating correctly")

            process.exit(1)
        } else {
            console.log("\n🎉 All playground tests passed!")
            console.log("\n✨ The new playground state architecture is ready for integration!")
            process.exit(0)
        }
    } catch (error) {
        console.error("\n❌ Test runner failed:", error)
        console.error("\n🔧 Debug steps:")
        console.error("  1. Ensure all dependencies are installed: pnpm install")
        console.error("  2. Check that TypeScript paths are configured correctly")
        console.error("  3. Verify all atom imports are valid")
        console.error("  4. Check environment variables if needed")
        process.exit(1)
    }
}

// Run if executed directly
if (require.main === module) {
    main()
}

export {main as runPlaygroundTests}
