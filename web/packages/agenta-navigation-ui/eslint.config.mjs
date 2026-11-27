/**
 * @agenta/navigation-ui renders the nav model antd-free: rows, menus, switch controls — the
 * pieces both the desktop rail and the mobile drawer compose. antd is banned; @agenta/ui is
 * subpath-only (its root barrel re-exports the whole kit and the table).
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
                                "Import a subpath ('@agenta/ui/ui', '@agenta/ui/composed', '@agenta/ui/layout', '@agenta/ui/components/presentational'): the root barrel re-exports the whole kit and the table.",
                        },
                    ],
                    patterns: [
                        {
                            group: ["antd", "antd/*", "@ant-design/*"],
                            message:
                                "@agenta/navigation-ui is antd-free. Use plain elements or the Radix primitives from '@agenta/ui/ui'.",
                        },
                    ],
                },
            ],
        },
    },
]
