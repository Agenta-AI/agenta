import {fileURLToPath} from "node:url"

import {defineConfig} from "vitest/config"

export default defineConfig({
    resolve: {
        // Mirror tsconfig's `@/*` -> `src/*` so tested modules resolve app imports.
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
            // No Next app is mounted, so every copy of Next gets one inert router. See the stub.
            "next/router": fileURLToPath(new URL("./tests/stubs/nextRouter.ts", import.meta.url)),
        },
    },
    test: {
        include: ["tests/unit/**/*.test.{ts,tsx}"],
        environment: "node",
    },
})
