/**
 * @agenta/auth-ui is antd-FREE by contract: plain elements + semantic token classes, so the
 * mobile app (shadcn tokens) and the desktop (token bridge) both render it without pulling a
 * component library. Anything app-specific arrives as props.
 */
import base from "../eslint.config.mjs"

export default [
    ...base,
    {
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["antd", "antd/*", "@ant-design/*", "@agenta/ui", "@agenta/ui/*"],
                            message:
                                "@agenta/auth-ui is antd-free and component-library-free — plain elements with semantic token classes only.",
                        },
                    ],
                },
            ],
        },
    },
]
