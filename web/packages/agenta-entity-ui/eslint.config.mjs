/**
 * Base packages config, plus one directory contract: `src/agent/**` is antd-FREE so mobile can
 * adopt the agent surfaces. The rest of the package still uses antd (EntityPicker, modals) and
 * is unaffected.
 */
import base from "../eslint.config.mjs"

export default [
    ...base,
    {
        files: ["src/agent/**"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            name: "@agenta/sdk",
                            message:
                                "Import per-resource accessors from '@agenta/sdk/resources' — the root barrel bundles all 27 Fern resource clients.",
                        },
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
                                "src/agent is antd-free. Use the Radix primitives from '@agenta/ui/ui', or take the element as a slot.",
                        },
                    ],
                },
            ],
        },
    },
]
