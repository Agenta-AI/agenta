/**
 * @agenta/sessions is HEADLESS: orchestration only, zero UI imports. The bans below are the
 * package's contract — mobile consumes these hooks without pulling antd or web components.
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
                                "@agenta/sessions is headless — no UI imports. Rendering belongs in @agenta/sessions-ui or the app.",
                        },
                    ],
                },
            ],
        },
    },
]
