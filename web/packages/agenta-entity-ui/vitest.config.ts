import react from "@vitejs/plugin-react-swc"
import {defineConfig} from "vitest/config"

export default defineConfig({
    // The elicitation render test is .tsx and needs a JSX transform, exactly as the note below
    // predicted. Same setup as agenta-ui / agenta-observability-ui.
    plugins: [react()],
    test: {
        // `{ts,tsx}`, not `*.test.ts`: a `.tsx` suite added here would otherwise be silently
        // SKIPPED (that hid six render tests in @agenta/ui). Collecting it means a package with
        // no JSX transform fails loudly instead — add `@vitejs/plugin-react-swc` and
        // `plugins: [react()]` (see agenta-ui / agenta-observability-ui) when that happens.
        include: ["tests/unit/**/*.test.{ts,tsx}"],
        environment: "jsdom",
    },
})
