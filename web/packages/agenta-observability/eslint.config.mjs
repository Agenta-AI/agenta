/**
 * @agenta/observability is HEADLESS: the analytics query and its range state, zero UI imports.
 * Cards that render this data live in @agenta/home-ui or the app.
 */
import base from "../eslint.config.mjs"

export default [
    ...base,
    {
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
                    ],
                    patterns: [
                        {
                            group: [
                                "antd",
                                "antd/*",
                                "@ant-design/*",
                                "@agenta/ui",
                                "@agenta/ui/*",
                                "@agenta/entity-ui",
                                "@agenta/entity-ui/*",
                            ],
                            message:
                                "@agenta/observability is headless — no UI imports. Rendering belongs in @agenta/home-ui or the app.",
                        },
                    ],
                },
            ],
        },
    },
]
