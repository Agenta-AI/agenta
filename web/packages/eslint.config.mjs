/**
 * Shared ESLint config for @agenta/* packages
 *
 * This is the same as the root config without Next.js plugins.
 * Packages are pure TypeScript/React libraries.
 */
import path from "node:path"
import {fileURLToPath} from "node:url"

import {FlatCompat} from "@eslint/eslintrc"
import eslint from "@eslint/js"
import importPlugin from "eslint-plugin-import"
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
    ...compat.extends("plugin:@lexical/recommended"),
    ...tsEslintConfig,
    {
        languageOptions: {
            parserOptions: {
                tsconfigRootDir: __dirname,
            },
        },
        plugins: {
            import: importPlugin,
        },
        settings: {
            "import/resolver": {
                typescript: {
                    alwaysTryTypes: true,
                    project: [
                        path.join(__dirname, "agenta-entities/tsconfig.json"),
                        path.join(__dirname, "agenta-ui/tsconfig.json"),
                        path.join(__dirname, "agenta-shared/tsconfig.json"),
                    ],
                },
            },
        },
        rules: {
            "prefer-const": "off",
            "no-self-assign": "off",
            "no-empty": "off",
            "no-case-declarations": "off",
            "no-useless-escape": "off",
            "no-prototype-builtins": "off",
            "no-useless-catch": "off",
            "@typescript-eslint/no-explicit-any": "error",
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
                    groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
                    pathGroupsExcludedImportTypes: ["react"],
                    pathGroups: [
                        {
                            pattern: "react",
                            group: "builtin",
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
    {
        ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts"],
    },
]

export default config
