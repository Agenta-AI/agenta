import {defineConfig} from "vitest/config"
import path from "path"

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        environment: "node",
    },
    resolve: {
        alias: {
            "@agenta/playground": path.resolve(__dirname, "src"),
        },
    },
})
