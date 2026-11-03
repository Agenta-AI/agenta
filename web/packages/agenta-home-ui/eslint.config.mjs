/**
 * @agenta/home-ui renders Home for BOTH apps, so it must stay antd-free — mobile bans antd
 * outright and any import here would land in its bundle.
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
                                "@agenta/home-ui is antd-free (mobile renders it). Use the Radix primitives from '@agenta/ui/ui', or take the element as a slot.",
                        },
                    ],
                },
            ],
        },
    },
]
