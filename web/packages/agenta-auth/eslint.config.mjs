/**
 * @agenta/auth is HEADLESS: the SuperTokens client layer, flow outcomes, and pure state
 * machines. No React, no UI imports — both the desktop and the mobile app render their own
 * shells over these functions (@agenta/auth-ui holds the shared components).
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
                                "react",
                                "react-dom",
                                "antd",
                                "antd/*",
                                "@ant-design/*",
                                "@agenta/ui",
                                "@agenta/ui/*",
                                "@agenta/entity-ui",
                                "@agenta/entity-ui/*",
                            ],
                            message:
                                "@agenta/auth is headless — no React or UI imports. Rendering belongs in @agenta/auth-ui or the app.",
                        },
                    ],
                },
            ],
        },
    },
]
