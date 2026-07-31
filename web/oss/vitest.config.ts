import path from "path"

import react from "@vitejs/plugin-react-swc"
import {defineConfig} from "vitest/config"

// Unit tests in web/oss are colocated with source (`src/**/*.test.ts`), unlike the
// `@agenta/*` packages that keep theirs under `tests/unit/`. The two path aliases
// mirror the ones in `tsconfig.json` so imports like `@/oss/lib/...` resolve the same
// way they do in the Next.js build. The junit report lands in `test-results/junit.xml`
// so the "12 - check unit tests" workflow collects it alongside the package reports.
export default defineConfig({
    // tsconfig.json sets `jsx: "preserve"` for the Next.js build, which leaves JSX in the
    // source and breaks vite's parser when a test transitively imports a `.tsx`. The React
    // SWC plugin transforms JSX itself, ignoring that tsconfig setting.
    plugins: [react()],
    resolve: {
        alias: [
            {find: /^@\/oss\/(.*)$/, replacement: path.resolve(__dirname, "./src/$1")},
            {
                find: /^@\/agenta-oss-common\/(.*)$/,
                replacement: path.resolve(__dirname, "./src/$1"),
            },
        ],
    },
    test: {
        include: ["src/**/*.test.{ts,tsx}"],
        environment: "jsdom",
        reporters: ["default", "junit"],
        outputFile: {
            junit: "./test-results/junit.xml",
        },
        coverage: {
            provider: "v8",
            include: ["src/**/*.{ts,tsx}"],
            exclude: ["src/**/*.test.{ts,tsx}", "src/**/index.ts", "src/**/index.tsx"],
            reporter: ["text", "lcov", "json-summary"],
            reportsDirectory: "./coverage",
        },
    },
})
