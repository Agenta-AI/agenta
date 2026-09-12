import react from "@vitejs/plugin-react-swc"
import {defineConfig} from "vitest/config"

export default defineConfig({
    plugins: [react()],
    test: {
        // `{ts,tsx}`, not `*.test.ts`: a `.tsx` suite added here would otherwise be silently
        // SKIPPED. Collecting it means a package with no JSX transform fails loudly instead.
        include: ["tests/unit/**/*.test.{ts,tsx}"],
        environment: "jsdom",
        reporters: ["default", "junit"],
        outputFile: {junit: "./test-results/junit.xml"},
    },
})
