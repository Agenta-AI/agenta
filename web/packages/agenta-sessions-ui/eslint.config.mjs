/**
 * @agenta/sessions-ui is antd-FREE by contract — mobile consumes these components without
 * pulling antd. Anything not yet portable (the agent picker) is a slot the app injects.
 * `@agenta/ui` is allowed via subpaths only: its ROOT barrel still exports antd-backed
 * components (EnhancedModal), which would defeat the ban transitively.
 */
import base, {restrictedImportPaths} from "../eslint.config.mjs"

export default [
    ...base,
    {
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [
                        ...restrictedImportPaths,
                        {
                            name: "@agenta/ui",
                            message:
                                "Import a subpath ('@agenta/ui/ui', '@agenta/ui/components/presentational') — the root barrel exports antd-backed components.",
                        },
                    ],
                    patterns: [
                        {
                            group: ["antd", "antd/*", "@ant-design/*"],
                            message:
                                "@agenta/sessions-ui is antd-free. Use the Radix primitives from '@agenta/ui/ui', or take the element as a slot.",
                        },
                    ],
                },
            ],
        },
    },
]
