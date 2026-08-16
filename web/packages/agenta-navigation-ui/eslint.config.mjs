/**
 * @agenta/navigation-ui renders the nav model antd-free: rows, menus, switch controls — the
 * pieces both the desktop rail and the mobile drawer compose. antd is banned; @agenta/ui is
 * subpath-only (its root barrel exports antd-backed components).
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
                            name: "@agenta/ui",
                            message:
                                "Import a subpath ('@agenta/ui/ui', '@agenta/ui/components/presentational') — the root barrel exports antd-backed components.",
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
