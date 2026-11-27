import react from "@vitejs/plugin-react-swc"
import {defineConfig} from "vitest/config"

export default defineConfig({
    // Render tests are .tsx and need a JSX transform.
    plugins: [react()],
    test: {
        include: ["tests/unit/**/*.test.{ts,tsx}"],
        // Node by default; render tests opt into jsdom with a @vitest-environment docblock.
        environment: "node",
        // The web unit workflow collects `web/packages/*/test-results/junit.xml`.
        reporters: ["default", "junit"],
        outputFile: {
            junit: "./test-results/junit.xml",
        },
    },
})
