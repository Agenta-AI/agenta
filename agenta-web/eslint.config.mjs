import path from "node:path"
import {fileURLToPath} from "node:url"

import {FlatCompat} from "@eslint/eslintrc"
import eslint from "@eslint/js"
import tseslint from "typescript-eslint"
import prettierConfig from "eslint-config-prettier"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: eslint.configs.recommended,
    allConfig: eslint.configs.all,
})

const tsEslintConfig = tseslint.config(
    eslint.configs.recommended,
    tseslint.configs.recommended,
    tseslint.configs.stylistic,
    prettierConfig,
)

export default [
    ...compat.extends("next/core-web-vitals"),
    ...tsEslintConfig,
    {
        rules: {
            "react/no-unescaped-entities": 0,
            "react/display-name": 0,
            "@next/next/no-sync-scripts": 0,
            "react/no-children-prop": 0,
            "react-hooks/exhaustive-deps": "off",
            "no-unused-vars": [
                "warn",
                {
                    vars: "all",
                    args: "none",
                    caughtErrors: "none",
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
                    groups: ["builtin", "external", "parent", "sibling", "index"],
                    pathGroupsExcludedImportTypes: ["react"],
                    pathGroups: [
                        {
                            pattern: "react",
                            group: "external",
                            position: "before",
                        },
                        {
                            pattern: "./__generated__/**",
                            group: "parent",
                            position: "before",
                        },
                        {
                            pattern: "@/**",
                            group: "parent",
                            position: "before",
                        },
                    ],
                },
            ],
        },
    },
]
