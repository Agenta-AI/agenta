import {defineConfig} from "vitest/config"
import {fileURLToPath} from "node:url"

/**
 * Minimal vitest config scoped to THIS package only.
 *
 * Without `root` pinned to this package, Vite/Vitest inherits `web/tsconfig.json`
 * which globs `**​/*.ts` across the entire monorepo and OOMs (heap > 4GB) trying
 * to type-check everything in the worktree. Pinning `root` keeps test discovery
 * local.
 *
 * Pain log candidate (not yet filed): "raw OTel + spike-verify in a Next.js
 * monorepo: vitest inherits the workspace tsconfig and OOMs on first run unless
 * you scope `root` and avoid the parent tsconfig graph."
 */
const here = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
    root: here,
    test: {
        environment: "node",
        include: ["test/**/*.test.ts"],
        // Single fork keeps memory bounded; tests are pure logic, no need for parallelism.
        pool: "forks",
        poolOptions: {
            forks: {
                singleFork: true,
            },
        },
    },
    // Explicitly isolate from parent vite/tsconfig graphs.
    resolve: {
        preserveSymlinks: false,
    },
})
