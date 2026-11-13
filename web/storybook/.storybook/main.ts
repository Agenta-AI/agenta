import {createRequire} from "node:module"
import path from "node:path"

import type {StorybookConfig} from "@storybook/nextjs"
import remarkGfm from "remark-gfm"

const require = createRequire(import.meta.url)

const config: StorybookConfig = {
    framework: {name: "@storybook/nextjs", options: {}},
    stories: [
        // MDX overview pages (per-folder "quick context") sit alongside the stories.
        "../stories/**/*.mdx",
        "../stories/**/*.stories.@(ts|tsx)",
        // Stories co-located inside the workspace packages are picked up too.
        "../../packages/*/src/**/*.stories.@(ts|tsx)",
    ],
    // Forces :hover/:focus-visible/etc statically so interaction states render without a real
    // cursor/keyboard. Adding a `pseudo-*`/`pseudo-*-all` class to an element (or ancestor)
    // makes its pseudo styles apply.
    // addon-docs (SB9 dissolved essentials) powers autodocs prop tables + MDX pages.
    // remark-gfm lets the Overview MDX pages use GitHub-flavoured markdown tables.
    addons: [
        "storybook-addon-pseudo-states",
        {
            name: "@storybook/addon-docs",
            options: {mdxPluginOptions: {mdxCompileOptions: {remarkPlugins: [remarkGfm]}}},
        },
    ],
    docs: {defaultName: "Docs"},
    // react-docgen-typescript extracts full prop types/unions + JSDoc from the TS source so
    // each component's autodocs page shows a complete props table. (Default `react-docgen`
    // only reads names.) The plugin is bundled by @storybook/nextjs.
    typescript: {
        reactDocgen: "react-docgen-typescript",
        reactDocgenTypescriptOptions: {
            shouldExtractLiteralValuesFromEnum: true,
            shouldRemoveUndefinedFromOptional: true,
            // Keep our own component props; drop inherited React DOM/intrinsic noise. Workspace
            // packages (@agenta/*) resolve to real src paths, not node_modules, so they're kept.
            propFilter: (prop) =>
                prop.parent
                    ? !/node_modules\/(@types\/react|typescript)\//.test(prop.parent.fileName)
                    : true,
        },
    },
    core: {disableTelemetry: true},
    webpackFinal: async (cfg) => {
        cfg.module ||= {}
        cfg.module.rules ||= []
        // Resolve PostCSS here, including CSS imported from another workspace.
        const prepareRules = (rules: NonNullable<NonNullable<typeof cfg.module>["rules"]>) => {
            for (const rule of rules) {
                if (!rule || typeof rule !== "object") continue
                if (rule.oneOf) prepareRules(rule.oneOf)
                if (rule.rules) prepareRules(rule.rules)
                if (rule.test instanceof RegExp && rule.test.test("demo.css")) {
                    rule.resourceQuery = {not: [/raw/]}
                }
                if (Array.isArray(rule.use)) {
                    rule.use = rule.use.map((entry) => {
                        const use = typeof entry === "string" ? {loader: entry} : entry
                        if (
                            use &&
                            typeof use === "object" &&
                            use.loader?.includes("postcss-loader")
                        ) {
                            return {
                                loader: use.loader,
                                options: {
                                    postcssOptions: {
                                        config: false,
                                        // The /m app's Tailwind v4. `base` makes automatic
                                        // source detection scan this package.
                                        plugins: [
                                            require("@tailwindcss/postcss")({
                                                base: path.resolve(__dirname, ".."),
                                            }),
                                        ],
                                    },
                                },
                            }
                        }
                        return entry
                    })
                }
            }
        }
        prepareRules(cfg.module.rules)
        cfg.module.rules.unshift({resourceQuery: /raw/, type: "asset/source"})
        cfg.resolve ||= {}
        // webpack types alias as an array OR a record; we only ever build the record form.
        const alias: Record<string, string | false | string[]> = {
            ...(Array.isArray(cfg.resolve.alias) ? {} : cfg.resolve.alias),
            // The /m app's own alias, for stories that render /m screens.
            "@": path.resolve(__dirname, "../../mobile/src"),
        }
        cfg.resolve.alias = alias
        // The /m annotation screens (the queue session, and the run's Annotate tab and sheet) read
        // two controllers that need a live queue or run. Their stories swap in a stand-in, for the
        // files of those folders only.
        cfg.module.rules.push({
            test: /mobile[\\/]src[\\/]features[\\/](annotations|evaluation-run[\\/]focus)[\\/]/,
            resolve: {
                alias: {
                    "@agenta/annotation$": path.resolve(
                        __dirname,
                        "../fixtures/annotationSession.ts",
                    ),
                },
            },
        })
        return cfg
    },
}

export default config
