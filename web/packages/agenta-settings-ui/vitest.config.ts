import react from "@vitejs/plugin-react-swc"
import {defineConfig} from "vitest/config"

export default defineConfig({
    plugins: [react()],
    test: {
        include: ["tests/unit/**/*.test.{ts,tsx}", "src/channels/qr/*.test.ts"],
        environment: "node",
        reporters: ["default", "junit"],
        outputFile: {junit: "./test-results/junit.xml"},
        coverage: {provider: "v8", include: ["src/channels/**/*.{ts,tsx}"]},
    },
})
