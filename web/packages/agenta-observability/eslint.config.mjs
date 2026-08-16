/**
 * @agenta/observability is HEADLESS: the analytics query and its range state, zero UI imports.
 * Cards that render this data live in @agenta/home-ui or the app.
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
