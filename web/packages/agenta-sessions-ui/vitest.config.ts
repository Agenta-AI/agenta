import react from "@vitejs/plugin-react-swc"
import {defineConfig} from "vitest/config"

export default defineConfig({
    // The rename suite is .tsx and needs a JSX transform; without a plugin rolldown cannot parse it.
    plugins: [react()],
    test: {
        // `{ts,tsx}`, not `*.test.ts`: a `.tsx` suite added here would otherwise be silently
        // SKIPPED (that hid six render tests in @agenta/ui). Collecting it means a package with
        // no JSX transform fails loudly instead — add `@vitejs/plugin-react-swc` and
        // `plugins: [react()]` (see agenta-ui / agenta-observability-ui) when that happens.
        include: ["tests/unit/**/*.test.{ts,tsx}"],
        environment: "jsdom",
        reporters: ["default", "junit"],
        outputFile: {junit: "./test-results/junit.xml"},
    },
})
