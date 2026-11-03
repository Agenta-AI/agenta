/** @agenta/auth-ui is antd-free: the shadcn kit (`@agenta/ui/ui`) and semantic tokens only. */
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
                            regex: "^(?:antd(?:/.*)?|@ant-design/.*|@agenta/ui(?:/(?!ui$).*)?)$",
                            message:
                                "@agenta/auth-ui is antd-free: use the shadcn kit (@agenta/ui/ui) and semantic token classes only.",
                        },
                    ],
                },
            ],
        },
    },
]
