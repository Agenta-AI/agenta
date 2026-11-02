#!/usr/bin/env node
// Speed budget for /m (web/mobile). Plain Node, no dependency.
//
//   node scripts/speed/check.mjs                 compare first-load JS with budget.json (needs a build)
//   node scripts/speed/check.mjs --dir=<path>    same, for a `.next` folder somewhere else
//   node scripts/speed/check.mjs --write         measure first-load JS and write it into budget.json
//   node scripts/speed/check.mjs --timing        measure `next build` and cold `next dev` time, compare
//   node scripts/speed/check.mjs --timing --write   ... and write the medians into budget.json
//
// First-load JS of a page = gzip size of the JavaScript files that the page needs on first
// load: the chunks of `/_app` (the shell every page shares) plus the chunks of the page itself,
// each file counted once. Chunks loaded later with next/dynamic are not first-load JS.
import {spawn, spawnSync} from "node:child_process"
import {existsSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {dirname, join, resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {gzipSync} from "node:zlib"

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, "../..")
// `--dir=<path>` points at a `.next` folder that is not in the app folder, for example one copied
// out of the built image in CI.
const dirArg = process.argv.slice(2).find((arg) => arg.startsWith("--dir="))
const nextDir = dirArg ? resolve(dirArg.slice("--dir=".length)) : join(appDir, ".next")
const budgetPath = join(here, "budget.json")

const args = new Set(process.argv.slice(2))
const WRITE = args.has("--write")
const TIMING = args.has("--timing")

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`
const readBudget = () => JSON.parse(readFileSync(budgetPath, "utf8"))
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

// ---------------------------------------------------------------------------------------------
// First-load JavaScript
// ---------------------------------------------------------------------------------------------

const gzipSizes = new Map()
const gzipSize = (file) => {
    if (!gzipSizes.has(file)) {
        gzipSizes.set(file, gzipSync(readFileSync(join(nextDir, file)), {level: 9}).length)
    }
    return gzipSizes.get(file)
}

const sumGzip = (files) => files.reduce((total, file) => total + gzipSize(file), 0)

function measureFirstLoad() {
    const manifestPath = join(nextDir, "build-manifest.json")
    if (!existsSync(manifestPath)) {
        throw new Error("No build found. Run `pnpm --filter @agenta/mobile exec next build` first.")
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    const jsOnly = (files) => files.filter((file) => file.endsWith(".js"))
    const shared = new Set(jsOnly([...manifest.polyfillFiles, ...(manifest.pages["/_app"] ?? [])]))
    const routes = {}
    for (const [route, files] of Object.entries(manifest.pages)) {
        if (route === "/_app" || route === "/_error") continue
        routes[route] = sumGzip([...new Set([...shared, ...jsOnly(files)])])
    }
    return {shell: sumGzip([...shared]), routes}
}

function limitFor(baseline, margin) {
    return (
        baseline + Math.max(Math.ceil((baseline * margin.sizePercent) / 100), margin.sizeMinBytes)
    )
}

function checkSizes() {
    const budget = readBudget()
    const now = measureFirstLoad()
    const failures = []
    const rows = []
    const compare = (name, current, baseline) => {
        const limit = limitFor(baseline, budget.margin)
        const grew = current - baseline
        rows.push({name, baseline, current, limit})
        if (current > limit) {
            failures.push(
                `${name}: ${kb(current)} is ${kb(current - limit)} over the limit ${kb(limit)} ` +
                    `(baseline ${kb(baseline)}, grew ${kb(grew)})`,
            )
        }
    }
    compare("app shell (/_app)", now.shell, budget.firstLoadGzipBytes.shell)
    for (const [route, baseline] of Object.entries(budget.firstLoadGzipBytes.routes)) {
        if (!(route in now.routes)) {
            console.log(`note: ${route} is in the budget but not in the build`)
            continue
        }
        compare(route, now.routes[route], baseline)
    }
    for (const route of Object.keys(now.routes)) {
        if (!(route in budget.firstLoadGzipBytes.routes)) {
            console.log(
                `note: new route ${route} has no budget (${kb(now.routes[route])}). ` +
                    "Add it with --write after review.",
            )
        }
    }
    console.log("first-load JS (gzip)")
    for (const row of rows) {
        console.log(
            `  ${row.current > row.limit ? "FAIL" : "ok  "} ${kb(row.current).padStart(10)} ` +
                `(limit ${kb(row.limit)})  ${row.name}`,
        )
    }
    if (failures.length > 0) {
        console.error("\nSPEED BUDGET FAILED. /m got heavier:")
        for (const failure of failures) console.error(`  - ${failure}`)
        console.error(
            "\nFix the cause (a dynamic import, a lighter import) before raising a budget. " +
                "Raising a budget needs Mahmoud's approval. See web/mobile/AGENTS.md.",
        )
        process.exit(1)
    }
    console.log("\nSpeed budget (size): pass")
}

function writeSizes() {
    const budget = readBudget()
    const now = measureFirstLoad()
    const routes = Object.fromEntries(
        Object.entries(now.routes).sort(([a], [b]) => (a < b ? -1 : 1)),
    )
    budget.firstLoadGzipBytes = {shell: now.shell, routes}
    saveBudget(budget)
    console.log(
        `Wrote first-load baselines (${Object.keys(routes).length} routes, shell ${kb(now.shell)}).`,
    )
}

function saveBudget(budget) {
    writeFileSync(budgetPath, `${JSON.stringify(budget, null, 4)}\n`)
}

// ---------------------------------------------------------------------------------------------
// Timing (local only)
// ---------------------------------------------------------------------------------------------

const RUNS = 3
const DEV_PORT = Number(process.env.SPEED_DEV_PORT ?? 3917)
const DEV_PAGES = {
    home: "/m",
    sessionPage: "/m/w/speed-workspace/p/speed-project/sessions/speed-session",
}

const nextBin = () => join(appDir, "node_modules", ".bin", "next")

function timeBuild() {
    rmSync(nextDir, {recursive: true, force: true})
    const started = performance.now()
    const result = spawnSync(nextBin(), ["build"], {cwd: appDir, stdio: "ignore", env: process.env})
    if (result.status !== 0) throw new Error("next build failed")
    return (performance.now() - started) / 1000
}

async function timeDev() {
    rmSync(nextDir, {recursive: true, force: true})
    const child = spawn(nextBin(), ["dev", "--port", String(DEV_PORT)], {
        cwd: appDir,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
        env: {...process.env, NEXT_TELEMETRY_DISABLED: "1"},
    })
    const stop = () => {
        try {
            process.kill(-child.pid, "SIGKILL")
        } catch {
            // already gone
        }
    }
    try {
        await new Promise((resolveReady, reject) => {
            const timer = setTimeout(
                () => reject(new Error("next dev did not become ready")),
                180_000,
            )
            const onData = (chunk) => {
                if (String(chunk).includes("Ready")) {
                    clearTimeout(timer)
                    resolveReady()
                }
            }
            child.stdout.on("data", onData)
            child.stderr.on("data", onData)
            child.on("exit", () => reject(new Error("next dev exited early")))
        })
        const times = {}
        for (const [name, path] of Object.entries(DEV_PAGES)) {
            const started = performance.now()
            const response = await fetch(`http://127.0.0.1:${DEV_PORT}${path}`, {
                redirect: "manual",
            })
            await response.arrayBuffer()
            if (response.status !== 200) {
                throw new Error(`${path} answered ${response.status}, expected 200`)
            }
            times[name] = (performance.now() - started) / 1000
        }
        return times
    } finally {
        stop()
        await new Promise((r) => setTimeout(r, 2000))
    }
}

async function runTiming() {
    const budget = readBudget()
    const builds = []
    const devHome = []
    const devSession = []
    for (let i = 0; i < RUNS; i++) {
        console.log(`run ${i + 1} of ${RUNS}: next build`)
        builds.push(timeBuild())
        console.log(`run ${i + 1} of ${RUNS}: next dev, cold`)
        const dev = await timeDev()
        devHome.push(dev.home)
        devSession.push(dev.sessionPage)
    }
    const now = {
        buildSeconds: median(builds),
        devCompileHomeSeconds: median(devHome),
        devCompileSessionPageSeconds: median(devSession),
    }
    console.log(
        `all runs: build ${builds.map((v) => v.toFixed(1))}, dev home ${devHome.map((v) => v.toFixed(1))}, dev session ${devSession.map((v) => v.toFixed(1))}`,
    )
    if (WRITE) {
        budget.timing = {
            ...Object.fromEntries(
                Object.entries(now).map(([k, v]) => [k, Math.round(v * 10) / 10]),
            ),
            note: "Median of 3 runs on a shared dev box. Machine dependent: compare only on the same box.",
        }
        saveBudget(budget)
        console.log("Wrote timing baselines.")
        return
    }
    const failures = []
    for (const [name, value] of Object.entries(now)) {
        const baseline = budget.timing?.[name]
        if (baseline === undefined) {
            console.log(`note: no timing baseline for ${name}`)
            continue
        }
        const limit = baseline * (1 + budget.margin.timingPercent / 100)
        const bad = value > limit
        console.log(
            `  ${bad ? "FAIL" : "ok  "} ${name}: ${value.toFixed(1)} s (limit ${limit.toFixed(1)} s, baseline ${baseline.toFixed(1)} s)`,
        )
        if (bad) {
            failures.push(
                `${name}: ${value.toFixed(1)} s is ${(value - limit).toFixed(1)} s over ${limit.toFixed(1)} s`,
            )
        }
    }
    if (failures.length > 0) {
        console.error("\nSPEED TIMING FAILED:")
        for (const failure of failures) console.error(`  - ${failure}`)
        process.exit(1)
    }
    console.log("\nSpeed budget (timing): pass")
}

// ---------------------------------------------------------------------------------------------

if (TIMING) {
    await runTiming()
} else if (WRITE) {
    writeSizes()
} else {
    checkSizes()
}
