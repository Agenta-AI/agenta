import {createRequire} from "node:module"
import path from "node:path"

import type {StorybookConfig} from "@storybook/nextjs"
import remarkGfm from "remark-gfm"

const require = createRequire(import.meta.url)
const ossDir = path.resolve(__dirname, "../../oss")

// Force a SINGLE copy of the antd family, resolved from web/oss. antd v6 + rc-util
// keep theme/cssinjs state in module-level context; a second instance silently breaks
// the ConfigProvider theme. NOTE: do NOT alias react/react-dom here — Storybook + Next
// (HeadManagerProvider) own React resolution; forking it triggers "Invalid hook call /
// more than one copy of React". antd imports the (single, deduped) React regardless.
const SINGLETONS = ["antd", "@ant-design/icons", "rc-util"]

const config: StorybookConfig = {
    framework: {name: "@storybook/nextjs", options: {}},
    staticDirs: ["../public"],
    stories: [
        // MDX overview pages (per-folder "quick context") sit alongside the stories.
        "../stories/**/*.mdx",
        "../stories/**/*.stories.@(ts|tsx)",
        // Stories co-located inside the workspace packages are picked up too.
        "../../packages/*/src/**/*.stories.@(ts|tsx)",
    ],
    // Forces :hover/:focus-visible/etc statically so interaction states render without a real
    // cursor/keyboard — deterministic, and works identically on antd and @agenta/ui. Adding a
    // `pseudo-*`/`pseudo-*-all` class to an element (or ancestor) makes its pseudo styles apply.
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
        cfg.resolve ||= {}
        // webpack types alias as an array OR a record; we only ever build the record form.
        const alias: Record<string, string | false | string[]> = {
            ...(Array.isArray(cfg.resolve.alias) ? {} : cfg.resolve.alias),
            // App path alias used deep inside ThemeContextProvider and friends.
            // (@storybook/nextjs transforms next/font/google natively, incl. in the
            // transpiled @agenta/oss provider, so no font stub is needed.)
            "@/oss": path.resolve(ossDir, "src"),
        }
        for (const pkg of SINGLETONS) {
            try {
                alias[pkg] = path.dirname(require.resolve(`${pkg}/package.json`, {paths: [ossDir]}))
            } catch {
                // package not resolvable from oss — leave default resolution
            }
        }
        cfg.resolve.alias = alias
        return cfg
    },
}

export default config
