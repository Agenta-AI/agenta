import react from "@vitejs/plugin-react-swc"
import {defineConfig} from "vitest/config"

export default defineConfig({
    // The startup-label render test is .tsx and needs a JSX transform — exactly the case the note
    // below predicted. Same setup as agenta-ui / agenta-entity-ui.
    plugins: [react()],
    test: {
        // `{ts,tsx}`, not `*.test.ts`: a `.tsx` suite added here would otherwise be silently
        // SKIPPED (that hid six render tests in @agenta/ui). Collecting it means a package with
        // no JSX transform fails loudly instead — add `@vitejs/plugin-react-swc` and
        // `plugins: [react()]` (see agenta-ui / agenta-observability-ui) when that happens.
        include: ["tests/unit/**/*.test.{ts,tsx}"],
        environment: "jsdom",
        reporters: ["default", "junit"],
        outputFile: {
            junit: "./test-results/junit.xml",
        },
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: ["src/**/index.ts"],
            reporter: ["text", "lcov", "json-summary"],
            reportsDirectory: "./coverage",
        },
    },
})
