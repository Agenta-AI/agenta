/**
 * @agenta/navigation is the nav MODEL: scopes, entries, gated dynamic sources. Hooks are
 * allowed (they orchestrate state), rendering is not — rails, drawers, and rows live in the
 * apps and @agenta/ui. The antd ban is the package's contract with the mobile app.
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
                            ],
                            message:
                                "@agenta/navigation is headless — no UI imports. Rendering belongs in @agenta/ui's nav primitives or the app shells.",
                        },
                    ],
                },
            ],
        },
    },
]
