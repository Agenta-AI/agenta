/**
 * Playwright Test Runner Script
 * Executes test suites with support for test dimension filtering.
 *
 * Converts test dimension flags (--coverage, --lens, etc.) into Playwright --grep patterns.
 * Example: --coverage smoke --path happy -> --grep "@coverage:smoke.*@path:happy"
 */

import {execSync} from "child_process"

// Test dimension types and their tag prefixes
const DIMENSION_PREFIXES: Record<string, string> = {
    coverage: "@coverage:",
    lens: "@lens:",
    path: "@path:",
    case: "@case:",
    speed: "@speed:",
    scope: "@scope:",
    license: "@license:",
    cost: "@cost:",
    plan: "@plan:",
    role: "@role:",
}

interface ParsedArgs {
    grepPatterns: string[]
    playwrightArgs: string[]
}

function parseArgs(args: string[]): ParsedArgs {
    const grepPatterns: string[] = []
    const playwrightArgs: string[] = []

    let i = 0
    while (i < args.length) {
        const arg = args[i]

        // Check if this is a dimension flag
        const dimensionMatch = arg.match(/^--?(coverage|lens|path|case|speed|scope|license|cost|plan|role)$/)

        if (dimensionMatch && i + 1 < args.length) {
            const dimension = dimensionMatch[1]
            const value = args[i + 1]
            const prefix = DIMENSION_PREFIXES[dimension]
            grepPatterns.push(`${prefix}${value}`)
            i += 2 // Skip both the flag and its value
        } else {
            // Pass through to playwright
            playwrightArgs.push(arg)
            i++
        }
    }

    return {grepPatterns, playwrightArgs}
}

function buildCommand(grepPatterns: string[], playwrightArgs: string[]): string {
    const parts = ["playwright", "test"]

    // Add grep pattern if we have dimension filters
    if (grepPatterns.length > 0) {
        // Combine patterns with .* to match all dimensions
        const grepExpression = grepPatterns.join(".*")
        parts.push("--grep", `"${grepExpression}"`)
    }

    // Add remaining playwright arguments
    parts.push(...playwrightArgs)

    return parts.join(" ")
}

// Parse command line arguments (skip node and script paths)
const args = process.argv.slice(2)
const {grepPatterns, playwrightArgs} = parseArgs(args)

// Build and execute the command
const command = buildCommand(grepPatterns, playwrightArgs)
console.log(`Executing: ${command}`)

try {
    execSync(command, {stdio: "inherit"})
} catch (error) {
    process.exit(1)
}
