import type {Config} from "tailwindcss"

// Reuse the app's exact Tailwind config via its factory — including the shadcn
// shadcn token bridge (shadcnTokens), which now lives in createConfig and is shared
// by the app + Storybook. Storybook only adds its own content sources; the bridge is
// NOT redefined here (single source of truth).
import {createConfig} from "../oss/tailwind.config"

const config: Config = createConfig([
    "../oss/src/**/*.{ts,tsx}",
    "../packages/*/src/**/*.{ts,tsx}",
    "./stories/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./.storybook/**/*.{ts,tsx}",
])

export default config
