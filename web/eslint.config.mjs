import path from "node:path"
import {fileURLToPath} from "node:url"

import {FlatCompat} from "@eslint/eslintrc"
import eslint from "@eslint/js"
import eslintPluginPrettier from "eslint-plugin-prettier/recommended"
import tseslint from "typescript-eslint"

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
)

const config = [
    ...compat.extends("next/core-web-vitals"),
    ...compat.extends("plugin:@lexical/recommended"),
    ...tsEslintConfig,
    // Prevent re-exporting from @agenta/* packages in app layer (oss/src and ee/src)
    // This ensures consumers import directly from packages for proper tree-shaking
    {
        files: ["oss/src/**/*.ts", "oss/src/**/*.tsx", "ee/src/**/*.ts", "ee/src/**/*.tsx"],
        rules: {
            "no-restricted-syntax": [
                "error",
                {
                    selector: 'ExportNamedDeclaration[source.value=/^@agenta/]',
                    message:
                        "Do not re-export from @agenta/* packages. Consumers should import directly from the source package for proper tree-shaking.",
                },
                {
                    selector: 'ExportAllDeclaration[source.value=/^@agenta/]',
                    message:
                        "Do not re-export from @agenta/* packages. Consumers should import directly from the source package for proper tree-shaking.",
                },
            ],
        },
    },
    {
        rules: {
            "prefer-const": "off",
            "no-self-assign": "off",
            "no-empty": "off",
            "no-case-declarations": "off",
            "react/no-unescaped-entities": 0,
            "react/display-name": 0,
            "@next/next/no-sync-scripts": 0,
            "react/no-children-prop": 0,
            "react-hooks/exhaustive-deps": "off",
            // Disable new strict rules from eslint-plugin-react-hooks@7.x and React Compiler
            // These can be enabled incrementally as the codebase is updated
            "react-hooks/set-state-in-effect": "off",
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/preserve-manual-memoization": "off",
            "react-hooks/refs": "off",
            "react-hooks/variables": "off",
            "react-hooks/immutability": "off",
            "react-hooks/use-memo": "off",
            "react-hooks/use-callback": "off",
            "react-hooks/use-effect": "off",
            "react-hooks/purity": "off",
            "react-hooks/globals": "off",
            "react-compiler/react-compiler": "off",
            "import/no-anonymous-default-export": "off",
            "no-useless-escape": "off",
            "no-prototype-builtins": "off",
            "no-useless-catch": "off",
            "@next/next/no-html-link-for-pages": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-empty-object-type": "off",
            "@typescript-eslint/ban-ts-comment": "off",
            "@typescript-eslint/no-empty-function": "off",
            "@typescript-eslint/no-non-null-asserted-optional-chain": "off",
            "@typescript-eslint/no-non-null-assertion": "off",
            "@typescript-eslint/no-unsafe-function-type": "off",
            "@typescript-eslint/no-unused-expressions": "off",
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
                    groups: ["builtin", "external", "parent", "sibling", "index"],
                    pathGroupsExcludedImportTypes: ["react"],
                    pathGroups: [
                        {
                            pattern: "react",
                            group: "builtin",
                            position: "before",
                        },
                        {
                            pattern: "./__generated__/**",
                            group: "parent",
                            position: "before",
                        },
                        {
                            pattern: "@/oss/**",
                            group: "parent",
                            position: "before",
                        },
                    ],
                },
            ],
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
        },
    },
    eslintPluginPrettier,
]

export default config
