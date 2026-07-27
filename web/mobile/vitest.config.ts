import {fileURLToPath} from "node:url"

import {defineConfig} from "vitest/config"

export default defineConfig({
    resolve: {
        // Mirror tsconfig's `@/*` -> `src/*` so tested modules resolve app imports.
        alias: {"@": fileURLToPath(new URL("./src", import.meta.url))},
    },
    test: {
        include: ["tests/unit/**/*.test.ts"],
        environment: "node",
    },
})
