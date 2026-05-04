import type {Config} from "tailwindcss"

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
        extend: {},
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
