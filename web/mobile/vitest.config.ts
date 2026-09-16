import {fileURLToPath} from "node:url"

import {defineConfig} from "vitest/config"

export default defineConfig({
    resolve: {
        // Mirror tsconfig's `@/*` -> `src/*` so tested modules resolve app imports.
        alias: {"@": fileURLToPath(new URL("./src", import.meta.url))},
        // One Next per run. The `@agenta/*` source packages carry their own `next` dependency, so
        // without this a test renders components reading two different router contexts — which is
        // not what the bundled app does, and makes a `next/router` mock cover only half the tree.
        dedupe: ["next"],
    },
    test: {
        include: ["tests/unit/**/*.test.{ts,tsx}"],
        environment: "node",
    },
})
