/**
 * The `@agenta/*` workspace dependency graph must stay ACYCLIC.
 *
 * A cycle here is not a style problem. pnpm links a workspace dependency as a symlink under
 * `<pkg>/node_modules/@agenta/<dep>`, so two packages that depend on each other produce a
 * directory tree of unbounded depth. Webpack's `FileSystemInfo` hashes a context directory by
 * walking it recursively, and it resolves each symlink to its absolute target before recursing —
 * so the walk ping-pongs between the two package directories forever. The `next build` of
 * `@agenta/oss` then dies with `RangeError: Invalid array length` (or a heap OOM, depending on the
 * cap) inside `FileSystemInfo._getUnresolvedContextTsh`, with no stack and no module name.
 *
 * Nothing else catches this. TypeScript, ESLint, and every unit test are happy with a cycle; the
 * dev server is happy with it; only the production build dies, and it dies without saying why.
 * This test is the cheap check that turns "bisect the release branch" back into "read the failure".
 *
 * If you need a value from a package that already depends on yours, move that value DOWN to a
 * package below both of you (see `useToolsConnections` in `@agenta/entities/gatewayTool` and the
 * client-tool contract in `@agenta/shared/clientTools`), or pass it in as a prop.
 */
import {readFileSync, readdirSync} from "node:fs"
import {join} from "node:path"

import {describe, expect, it} from "vitest"

const PACKAGES_DIR = join(__dirname, "../../..")

const readGraph = (): Map<string, string[]> => {
    const graph = new Map<string, string[]>()
    for (const dir of readdirSync(PACKAGES_DIR)) {
        let pkg: {
            name?: string
            dependencies?: Record<string, string>
            devDependencies?: Record<string, string>
            peerDependencies?: Record<string, string>
        }
        try {
            pkg = JSON.parse(readFileSync(join(PACKAGES_DIR, dir, "package.json"), "utf8"))
        } catch {
            continue // not a package directory
        }
        if (!pkg.name) continue
        // Every kind counts: pnpm creates the symlink for a devDependency too.
        const all = {...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies}
        graph.set(
            pkg.name,
            Object.entries(all)
                .filter(
                    ([name, range]) => name.startsWith("@agenta") && range.startsWith("workspace:"),
                )
                .map(([name]) => name),
        )
    }
    return graph
}

/** Depth-first search that returns the first cycle found, as the path that closes it. */
const findCycle = (graph: Map<string, string[]>): string[] | null => {
    const state = new Map<string, "open" | "done">()
    const stack: string[] = []

    const visit = (node: string): string[] | null => {
        if (state.get(node) === "done") return null
        if (state.get(node) === "open") return [...stack.slice(stack.indexOf(node)), node]
        state.set(node, "open")
        stack.push(node)
        for (const next of graph.get(node) ?? []) {
            const cycle = visit(next)
            if (cycle) return cycle
        }
        stack.pop()
        state.set(node, "done")
        return null
    }

    for (const node of graph.keys()) {
        const cycle = visit(node)
        if (cycle) return cycle
    }
    return null
}

describe("@agenta workspace package graph", () => {
    const graph = readGraph()

    it("reads every workspace package", () => {
        // A guard on the guard: a broken PACKAGES_DIR would make the cycle check vacuous.
        expect(graph.size).toBeGreaterThan(10)
        expect(graph.has("@agenta/shared")).toBe(true)
        expect(graph.has("@agenta/chat")).toBe(true)
    })

    it("has no dependency cycle", () => {
        const cycle = findCycle(graph)
        expect(
            cycle,
            cycle
                ? `Workspace dependency cycle: ${cycle.join(" -> ")}\n` +
                      "pnpm turns this into an endless node_modules symlink chain and the " +
                      "production next build hangs on it. Move the shared value down to a " +
                      "package below both, or pass it in as a prop."
                : undefined,
        ).toBeNull()
    })
})
