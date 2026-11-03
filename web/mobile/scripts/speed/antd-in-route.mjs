#!/usr/bin/env node
// Fails when the JavaScript a route can load contains antd. Plain Node, no dependency.
//
//   node scripts/speed/antd-in-route.mjs                     check the playground route (needs a build)
//   node scripts/speed/antd-in-route.mjs --route=<pattern>   check another route, for example
//                                                            /w/[workspace_id]/p/[project_id]/endpoints
//   node scripts/speed/antd-in-route.mjs --dir=<path>        a `.next` folder somewhere else
//
// A route's JavaScript is the chunks the build manifest lists for it, the chunks its
// `next/dynamic` imports load (the route's react-loadable manifest), and every chunk those chunks
// name, followed to the end, less what the app shell (`/_app`) already loads. The check reads the source map of each chunk (`/m` builds with
// `productionBrowserSourceMaps`) and fails on any source under `node_modules/antd` or
// `@ant-design`. The lint ban on `@agenta/playground-ui/src/panels` cannot see transitive
// imports; this check can.
import {existsSync, readFileSync} from "node:fs"
import {dirname, join, resolve} from "node:path"
import {fileURLToPath} from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, "../..")
const argValue = (name) =>
    process.argv
        .slice(2)
        .find((arg) => arg.startsWith(`--${name}=`))
        ?.slice(name.length + 3)

const nextDir = argValue("dir") ? resolve(argValue("dir")) : join(appDir, ".next")
const route = argValue("route") ?? "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground"

const ANTD_SOURCE = /node_modules\/(antd|@ant-design)\//
const CHUNK_PATH = /static\/chunks\/[A-Za-z0-9_.~-]+\.js/g

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))

const buildManifestPath = join(nextDir, "build-manifest.json")
if (!existsSync(buildManifestPath)) {
    console.error("No build found. Run `pnpm --filter @agenta/mobile exec next build` first.")
    process.exit(1)
}
const buildManifest = readJson(buildManifestPath)
if (!buildManifest.pages[route]) {
    console.error(`The build has no route ${route}.`)
    process.exit(1)
}

// The chunks a page can load: its own, its `next/dynamic` imports, and every chunk those name.
const reachableFrom = (page) => {
    const loadableManifestPath = join(nextDir, "server/pages", page, "react-loadable-manifest.json")
    const dynamicFiles = existsSync(loadableManifestPath)
        ? Object.values(readJson(loadableManifestPath)).flatMap((entry) => entry.files)
        : []
    const found = new Set()
    const queue = [...(buildManifest.pages[page] ?? []), ...dynamicFiles].filter((file) =>
        file.endsWith(".js"),
    )
    while (queue.length > 0) {
        const file = queue.pop()
        if (found.has(file) || !existsSync(join(nextDir, file))) continue
        found.add(file)
        for (const named of readFileSync(join(nextDir, file), "utf8").match(CHUNK_PATH) ?? []) {
            if (!found.has(named)) queue.push(named)
        }
    }
    return found
}

// The app shell and its own dynamic imports are every page's baseline (`@agenta/ui/ui` already
// reaches `@ant-design/icons` there). Only what the route adds on top is checked.
const shellFiles = reachableFrom("/_app")
const files = new Set([...reachableFrom(route)].filter((file) => !shellFiles.has(file)))

const sourcesOf = (file) => {
    const code = readFileSync(join(nextDir, file), "utf8")
    const mapName = code.match(/\/\/# sourceMappingURL=(\S+)\s*$/)?.[1]
    if (!mapName) return []
    const mapPath = join(nextDir, dirname(file), mapName)
    if (!existsSync(mapPath)) return []
    const map = readJson(mapPath)
    // Turbopack can write an index map: one map per section.
    const maps = map.sections ? map.sections.map((section) => section.map) : [map]
    return maps.flatMap((part) => part.sources ?? [])
}

const offenders = new Map()
let mapped = 0
for (const file of files) {
    const sources = sourcesOf(file)
    if (sources.length > 0) mapped += 1
    for (const source of sources) {
        if (ANTD_SOURCE.test(source)) {
            offenders.set(source, [...(offenders.get(source) ?? []), file])
        }
    }
}

if (mapped === 0) {
    console.error(`No source maps found for ${route}. Is productionBrowserSourceMaps on?`)
    process.exit(1)
}

if (offenders.size > 0) {
    console.error(`ANTD FOUND in ${route} (${files.size} chunks checked):`)
    for (const [source, chunks] of offenders) {
        console.error(`  - ${source}\n      in ${chunks.join(", ")}`)
    }
    process.exit(1)
}
console.log(`No antd in ${route}: ${files.size} chunks checked, ${mapped} with source maps.`)
