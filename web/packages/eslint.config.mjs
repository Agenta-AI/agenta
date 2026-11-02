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

const includePrettierRule = process.env.DISABLE_PRETTIER !== "true"

/**
 * Import bans every @agenta/* package inherits. A package config that overrides
 * `no-restricted-imports` must spread this into its own `paths`, or it drops the bans.
 */
export const restrictedImportPaths = [
    // Root barrel statically imports the monolithic AgentaApiClient (all 27 resource
    // clients, ~300KB parsed) into any eager import graph. Regressed once (June fix, July relapse).
    {
        name: "@agenta/sdk",
        message:
            "Import per-resource accessors from '@agenta/sdk/resources' (or '@agenta/sdk/config' for host pinning) — the root barrel bundles all 27 Fern resource clients.",
    },
    // A host that installs its own QueryClient (as /m did) turns every write on the
    // singleton into a silent no-op. Read the host's client instead.
    {
        name: "@agenta/shared/api",
        importNames: ["queryClient"],
        message:
            "Use `getHostQueryClient()` from '@agenta/shared/api' — the `queryClient` singleton is only for hosts to pass to <QueryClientProvider>; package writes on it are dead when the host installed its own client.",
    },
    // Same singleton, reachable through the root barrel's re-export.
    {
        name: "@agenta/shared",
        importNames: ["queryClient"],
        message:
            "Use `getHostQueryClient()` from '@agenta/shared/api' — the `queryClient` singleton is only for hosts to pass to <QueryClientProvider>; package writes on it are dead when the host installed its own client.",
    },
]

/**
 * Syntax bans every @agenta/* package inherits. `no-restricted-imports` does not see
 * `await import(...)`, so the singleton is banned again at the ImportExpression level.
 * A package config that overrides `no-restricted-syntax` must spread this into its options.
 */
export const restrictedSyntax = [
    {
        selector:
            'ImportExpression > Literal[value="@agenta/shared/api"], ImportExpression > Literal[value="@agenta/shared"]',
        message:
            "Dynamic-import '@agenta/shared/api/hostQueryClient' instead — importing the api barrel dynamically can reach the `queryClient` singleton, whose writes are dead on a host that installed its own client.",
    },
]

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
            "no-restricted-imports": ["error", {paths: restrictedImportPaths}],
            "no-restricted-syntax": ["error", ...restrictedSyntax],
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
        ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts"],
    },
]

export default config
