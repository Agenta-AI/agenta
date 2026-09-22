import react from "@vitejs/plugin-react-swc"
import {defineConfig} from "vitest/config"

export default defineConfig({
    // Every suite here renders a settings surface, so the JSX transform is not optional.
    // Same setup as agenta-entity-ui / agenta-ui.
    plugins: [react()],
    test: {
        // `{ts,tsx}`, not `*.test.ts`: a `.tsx` suite added here would otherwise be silently
        // SKIPPED (that hid six render tests in @agenta/ui). Collecting it means a package with
        // no JSX transform fails loudly instead.
        include: ["tests/unit/**/*.test.{ts,tsx}"],
        environment: "jsdom",
    },
})
