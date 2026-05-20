/**
 * Playwright Test Runner Script
 * Executes test suites with support for test dimension filtering.
 *
 * Converts test dimension flags (--coverage, --lens, etc.) into Playwright --grep patterns.
 * Example: --coverage smoke --path happy -> --grep "@coverage:smoke.*@path:happy"
 */

import {spawnSync} from "child_process"
import {existsSync, mkdirSync, readdirSync, writeFileSync} from "fs"
import {dirname, join, resolve} from "path"
import {fileURLToPath} from "url"

import {config as loadDotenv} from "dotenv"

const __dirname = dirname(fileURLToPath(import.meta.url))
// tests/ root is two levels up from tests/playwright/scripts/
const TESTS_ROOT = resolve(__dirname, "..", "..")
// web/ root is the workspace root holding both tests/ and packages/.
const WEB_ROOT = resolve(TESTS_ROOT, "..")

const TEST_LAYERS = ["unit", "integration", "acceptance"] as const
type TestLayer = (typeof TEST_LAYERS)[number]

// Each layer maps to a package script run across all workspace packages via
// `pnpm -r --if-present`. Packages that define the script (e.g. @agenta/entities)
// run their vitest suite for that layer; packages without it are skipped.
const LAYER_PACKAGE_SCRIPT: Record<TestLayer, string> = {
    unit: "test:unit",
    integration: "test:integration",
    acceptance: "test:acceptance",
}

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
    layer: TestLayer | null
    grepPatterns: string[]
    playwrightArgs: string[]
}

function parseLayer(value: string): TestLayer {
    if (!(TEST_LAYERS as readonly string[]).includes(value)) {
        throw new Error(`Unsupported test layer: ${value} (expected ${TEST_LAYERS.join("|")})`)
    }
    return value as TestLayer
}

function parseArgs(args: string[]): ParsedArgs {
    let envFile: string | null = null
    let layer: TestLayer | null = null
    const grepPatterns: string[] = []
    const playwrightArgs: string[] = []

    let i = 0
    while (i < args.length) {
        const arg = args[i]

        // CLI separator from package managers (pnpm test -- --flag)
        if (arg === "--") {
            i++
            continue
        }

        if (arg === "--layer") {
            if (i + 1 >= args.length) {
                throw new Error("--layer requires a value")
            }
            layer = parseLayer(args[i + 1])
            i += 2
            continue
        }

        if (arg.startsWith("--layer=")) {
            layer = parseLayer(arg.slice("--layer=".length))
            i++
            continue
        }

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
        const dimensionMatch = arg.match(
            /^--?(coverage|lens|path|case|speed|scope|license|cost|plan|role)$/,
        )

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

    return {envFile, layer, grepPatterns, playwrightArgs}
}

function getLicense(): string {
    return process.env.AGENTA_LICENSE === "ee" ? "ee" : "oss"
}

/** Mirrors run-tests.py: a layer folder counts as runnable only if it holds spec files. */
function hasSpecFiles(dir: string): boolean {
    if (!existsSync(dir)) {
        return false
    }
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
        if (entry.isDirectory()) {
            if (hasSpecFiles(join(dir, entry.name))) {
                return true
            }
        } else if (entry.name.endsWith(".spec.ts") || entry.name.endsWith(".spec.tsx")) {
            return true
        }
    }
    return false
}

/** Write an empty JUnit report so the publish step has a file to consume on skipped layers. */
function writeEmptyResults(): void {
    const resultsDir = join(TESTS_ROOT, "results", getLicense())
    mkdirSync(resultsDir, {recursive: true})
    writeFileSync(
        join(resultsDir, "junit.xml"),
        '<?xml version="1.0" encoding="utf-8"?>' +
            '<testsuite tests="0" failures="0" errors="0" skipped="0"></testsuite>',
        "utf-8",
    )
}

function buildPlaywrightArgs(grepPatterns: string[], playwrightArgs: string[]): string[] {
    const args = ["test"]

    // Add grep pattern if we have dimension filters
    if (grepPatterns.length > 0) {
        // Combine patterns with .* to match all dimensions
        const grepExpression = grepPatterns.join(".*")
        args.push("--grep", grepExpression)
    }

    // Add remaining playwright arguments
    args.push(...playwrightArgs)

    return args
}

/**
 * Run the layer's vitest suite across every workspace package that defines the
 * matching `test:<layer>` script (via `pnpm -r --if-present`). Packages without
 * the script are skipped, so this is a no-op when no package has tests for the
 * layer. Returns the exit status (0 = success, including the no-package case).
 *
 * License, env vars, and markers are handled the same way as the Playwright
 * phase: AGENTA_LICENSE / AGENTA_TEST_LAYER and any --env-file values are
 * already on process.env and inherited here, and dimension markers are
 * forwarded to vitest's name filter (-t) using the same grep expression.
 */
function runVitestLayer(targetLayer: TestLayer, grepPatterns: string[]): number {
    const script = LAYER_PACKAGE_SCRIPT[targetLayer]
    const pnpmArgs = ["-r", "--if-present", "run", script]

    // Forward dimension markers to vitest as a name filter, mirroring how the
    // Playwright phase turns them into --grep. Args after `--` reach vitest.
    if (grepPatterns.length > 0) {
        pnpmArgs.push("--", "-t", grepPatterns.join(".*"))
    }

    console.log(`Executing: pnpm ${pnpmArgs.join(" ")} (AGENTA_LICENSE=${getLicense()})`)
    const result = spawnSync("pnpm", pnpmArgs, {
        cwd: WEB_ROOT,
        stdio: "inherit",
        shell: false,
        env: process.env,
    })
    return result.status ?? 1
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

const {envFile, layer, grepPatterns, playwrightArgs} = parsedArgs

if (envFile) {
    const {error} = loadDotenv({path: envFile})
    if (error) {
        console.error(`Failed to load environment variables from ${envFile}: ${error.message}`)
        process.exit(1)
    }
    console.log(`Loaded environment variables from ${envFile}`)
}

// A layer runs every test source for that layer, regardless of runner:
//   1. package vitest suites (any package with a `test:<layer>` script), then
//   2. playwright specs in the license's `<license>/tests/playwright/<layer>`.
// Both phases share license/env/marker handling. We run both even if the first
// fails, then exit nonzero if either failed, so all failures surface in one run.
// Without --layer (raw playwright passthrough), only the playwright phase runs.
let failed = false

if (layer) {
    process.env.AGENTA_TEST_LAYER = layer

    // Phase 1 — package vitest suites (vitest runs before playwright).
    const vitestStatus = runVitestLayer(layer, grepPatterns)
    if (vitestStatus !== 0) {
        failed = true
    }

    // Phase 2 — playwright specs for this layer/license.
    const layerDir = join(TESTS_ROOT, "..", getLicense(), "tests", "playwright", layer)
    if (!hasSpecFiles(layerDir)) {
        console.log(
            `No ${layer} playwright specs for AGENTA_LICENSE=${getLicense()}; skipping playwright.`,
        )
        writeEmptyResults()
        process.exit(failed ? 1 : 0)
    }
    console.log(`Running ${layer} layer playwright (AGENTA_LICENSE=${getLicense()})`)
}

// Build and execute the playwright command
const playwrightCliArgs = buildPlaywrightArgs(grepPatterns, playwrightArgs)
console.log(`Executing: playwright ${playwrightCliArgs.join(" ")}`)

try {
    const result = spawnSync("playwright", playwrightCliArgs, {
        stdio: "inherit",
        shell: false,
    })
    if (result.status !== 0) {
        failed = true
    }
} catch {
    failed = true
}

process.exit(failed ? 1 : 0)
