/**
 * @agenta/settings is antd-FREE by contract — mobile consumes these components without
 * pulling antd. Anything not yet portable (an app-only flow) is a slot the app injects.
 * `@agenta/ui` is allowed via subpaths only: its ROOT barrel re-exports the whole kit and the
 * table, so one root import pulls all of it in.
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
                                "@agenta/settings is antd-free. Use the Radix primitives from '@agenta/ui/ui', or take the element as a slot.",
                        },
                    ],
                },
            ],
        },
    },
]
