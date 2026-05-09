import type {Config} from "tailwindcss"

import antdTailwind from "../../oss/src/styles/tokens/antd-tailwind.json"

const config: Config = {
    content: [
        "./src/**/*.{js,ts,jsx,tsx}",
        // Workspace packages so their utility classes get extracted
        "../../packages/agenta-ui/src/**/*.{js,ts,jsx,tsx}",
        "../../packages/agenta-entity-ui/src/**/*.{js,ts,jsx,tsx}",
        "../../packages/agenta-entities/src/**/*.{js,ts,jsx,tsx}",
        // The OSS app contains DrillInContent + everything it transitively
        // pulls in (TestcasesTableNew/fieldUtils, hooks, helpers). Scanning
        // the whole OSS src tree is the safest way to catch utility classes
        // anywhere in the import graph.
        "../../oss/src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        // Antd-derived color palette (blue-6, gold-6, magenta-6, etc.) —
        // matches the production OSS tailwind config so utility classes
        // emitted by shared components (e.g. ChatMessagesCellContent's
        // role-coloured role labels) actually resolve to colors instead of
        // inheriting body text. Without this, the cell renderer's gold
        // "system" / blue "user" / green "assistant" / magenta "tool"
        // labels render as plain dark text.
        extend: {
            colors: {
                ...antdTailwind,
            },
        },
    },
    plugins: [
        require("tailwind-scrollbar")({
            nocompatible: true,
            preferredStrategy: "pseudoelements",
        }),
    ],
    // Ant Design provides its own reset; let it own form/element defaults.
    corePlugins: {
        preflight: false,
    },
}

export default config
