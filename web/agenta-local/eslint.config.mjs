import eslint from "@eslint/js"
import importPlugin from "eslint-plugin-import"
import eslintPluginPrettier from "eslint-plugin-prettier/recommended"
import reactHooks from "eslint-plugin-react-hooks"
import tseslint from "typescript-eslint"

export default [
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    ...tseslint.configs.stylistic,
    {
        plugins: {import: importPlugin, "react-hooks": reactHooks},
        rules: {
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn",
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-unused-vars": ["error", {argsIgnorePattern: "^_"}],
            "import/order": [
                "error",
                {
                    alphabetize: {order: "asc", caseInsensitive: true},
                    "newlines-between": "always",
                    groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
                    pathGroups: [{pattern: "@/**", group: "internal"}],
                    pathGroupsExcludedImportTypes: ["react"],
                },
            ],
            "prettier/prettier": [
                "error",
                {printWidth: 100, tabWidth: 4, useTabs: false, semi: false, bracketSpacing: false},
            ],
        },
    },
    eslintPluginPrettier,
    {ignores: [".next/**", "out/**", "node_modules/**", "next-env.d.ts"]},
]
