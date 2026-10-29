import react from "@vitejs/plugin-react-swc"
import {defineConfig} from "vitest/config"

export default defineConfig({
    // Render tests are .tsx and need a JSX transform; without a plugin rolldown cannot parse them.
    // Same setup as agenta-observability-ui, whose .tsx suites have been running all along.
    plugins: [react()],
    test: {
        // `.tsx` too: six render tests (SplitPane single-mount, TooltipTrigger unmount,
        // VirtualTable, FeatureShell, ColumnVisibilityTrigger, dateRangePicker keyboard) sat in
        // this directory never running, because `*.test.ts` does not match `*.test.tsx`.
        include: ["tests/unit/**/*.test.{ts,tsx}"],
        // Node by default; render tests opt into jsdom with a @vitest-environment docblock.
        environment: "node",
        // The web unit workflow collects `web/packages/*/test-results/junit.xml`.
        reporters: ["default", "junit"],
        outputFile: {
            junit: "./test-results/junit.xml",
        },
        coverage: {
            provider: "v8",
            include: ["src/**/*.{ts,tsx}"],
            exclude: ["src/**/index.ts"],
            reporter: ["text", "lcov", "json-summary"],
            reportsDirectory: "./coverage",
        },
    },
})
