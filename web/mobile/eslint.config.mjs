/**
 * ESLint config for @agenta/mobile.
 *
 * Mirrors web/packages/eslint.config.mjs (flat config: tseslint + import
 * order + prettier, strict no-explicit-any) and adds the mobile hard bans:
 * no antd, no @ant-design/*, no app-layer imports (@/oss/*, @agenta/oss,
 * @agenta/ee). See web/mobile/AGENTS.md.
 */
import eslint from "@eslint/js"
import importPlugin from "eslint-plugin-import"
import eslintPluginPrettier from "eslint-plugin-prettier/recommended"
import tseslint from "typescript-eslint"

const includePrettierRule = process.env.DISABLE_PRETTIER !== "true"

const config = [
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    ...tseslint.configs.stylistic,
    {
        plugins: {
            import: importPlugin,
        },
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["antd", "antd/*"],
                            message:
                                "antd is banned in web/mobile. Use shadcn/ui components (src/components/ui) instead.",
                        },
                        {
                            group: ["@ant-design/*"],
                            message:
                                "@ant-design/* is banned in web/mobile. Use shadcn/ui + lucide-react instead.",
                        },
                        {
                            group: [
                                "@/oss/*",
                                "@agenta/oss",
                                "@agenta/oss/*",
                                "@agenta/ee",
                                "@agenta/ee/*",
                            ],
                            message:
                                "web/mobile never imports app-layer code. Consume @agenta/* packages only.",
                        },
                    ],
                },
            ],
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-empty-object-type": "off",
            "@typescript-eslint/ban-ts-comment": "off",
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    vars: "all",
                    args: "none",
                    caughtErrors: "none",
                    ignoreRestSiblings: true,
                    destructuredArrayIgnorePattern: "none",
                    varsIgnorePattern: "^_|^_.*",
                },
            ],
            "import/order": [
                "error",
                {
                    alphabetize: {
                        order: "asc",
                        caseInsensitive: true,
                    },
                    "newlines-between": "always",
                    groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
                    pathGroupsExcludedImportTypes: ["react"],
                    pathGroups: [
                        {
                            pattern: "react",
                            group: "builtin",
                            position: "before",
                        },
                        {
                            pattern: "@/**",
                            group: "internal",
                        },
                    ],
                },
            ],
            ...(includePrettierRule
                ? {
                      "prettier/prettier": [
                          "error",
                          {
                              printWidth: 100,
                              tabWidth: 4,
                              useTabs: false,
                              semi: false,
                              bracketSpacing: false,
                          },
                      ],
                  }
                : {}),
        },
    },
    ...(includePrettierRule ? [eslintPluginPrettier] : []),
    {
        ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
    },
]

export default config
