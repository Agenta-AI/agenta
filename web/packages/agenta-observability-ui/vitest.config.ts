import react from "@vitejs/plugin-react-swc"
import {defineConfig} from "vitest/config"

export default defineConfig({
    plugins: [react()],
    test: {
        include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
        // Node by default; render tests opt into jsdom with a @vitest-environment docblock.
        environment: "node",
    },
})
