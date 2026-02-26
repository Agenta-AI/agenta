/**
 * Playwright Test Runner Script
 * Executes test suites with support for test dimension filtering.
 *
 * Converts test dimension flags (--coverage, --lens, etc.) into Playwright --grep patterns.
 * Example: --coverage smoke --path happy -> --grep "@coverage:smoke.*@path:happy"
 */

import {execSync} from "child_process"
import {config as loadDotenv} from "dotenv"

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
    envFile: string | null
    grepPatterns: string[]
    playwrightArgs: string[]
}

function parseArgs(args: string[]): ParsedArgs {
    let envFile: string | null = null
    const grepPatterns: string[] = []
    const playwrightArgs: string[] = []

    let i = 0
    while (i < args.length) {
        const arg = args[i]

        if (arg === "--env-file") {
            if (i + 1 >= args.length) {
                throw new Error("--env-file requires a value")
            }
            envFile = args[i + 1]
            i += 2
            continue
        }

        if (arg.startsWith("--env-file=")) {
            envFile = arg.slice("--env-file=".length)
            i++
            continue
        }

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

    return {envFile, grepPatterns, playwrightArgs}
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
let parsedArgs: ParsedArgs
try {
    parsedArgs = parseArgs(args)
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
}

const {envFile, grepPatterns, playwrightArgs} = parsedArgs

if (envFile) {
    const {error} = loadDotenv({path: envFile})
    if (error) {
        console.error(`Failed to load environment variables from ${envFile}: ${error.message}`)
        process.exit(1)
    }
    console.log(`Loaded environment variables from ${envFile}`)
}

// Build and execute the command
const command = buildCommand(grepPatterns, playwrightArgs)
console.log(`Executing: ${command}`)

try {
    execSync(command, {stdio: "inherit"})
} catch (error) {
    process.exit(1)
}
