/**
 * @agenta/skills is HEADLESS: schema, API calls, atoms, and the embed writer — zero UI
 * imports. The bans below are the package's contract; mobile consumes these hooks without
 * pulling antd or web components.
 */
import base, {restrictedImportPaths} from "../eslint.config.mjs"

export default [
    ...base,
    {
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [...restrictedImportPaths],
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
                                "@agenta/skills-ui",
                                "@agenta/skills-ui/*",
                            ],
                            message:
                                "@agenta/skills is headless — no UI imports. Rendering belongs in @agenta/skills-ui or the app.",
                        },
                    ],
                },
            ],
        },
    },
]
