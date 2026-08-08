/**
 * generate-shadcn-tokens.ts — bridge the workspace theme source of truth
 * (web/oss/src/styles/theme/palette.ts) into shadcn/ui CSS variables for the
 * mobile app, light + dark.
 *
 * Follows the pattern of web/scripts/generate-tailwind-tokens.ts: palette.ts
 * is the ONLY color input; this file only chooses which palette role feeds
 * which shadcn variable. The output (src/styles/theme.generated.css) is
 * committed and must never be edited by hand — change palette.ts or the ROLE
 * MAP below and rerun.
 *
 * Run (from web/mobile): pnpm generate:tokens
 */
import {readdirSync, readFileSync, writeFileSync} from "fs"
import {dirname, resolve} from "path"
import {fileURLToPath} from "url"

import {controlScale} from "../../oss/src/styles/theme/controlScale"
import {shadcnTokens} from "../../oss/src/styles/theme/shadcnTokens"
import {palette, type ColorValue} from "../../oss/src/styles/theme/palette"

const HERE = dirname(fileURLToPath(import.meta.url)) // web/mobile/scripts
const OUT = resolve(HERE, "../src/styles/theme.generated.css")

/** Palette values are plain color strings except antd() shadow refs (never used here). */
const color = (v: ColorValue): string => {
    if (typeof v !== "string") {
        throw new Error(`Palette value is an antd() ref, not a color: ${JSON.stringify(v)}`)
    }
    return v
}

const p = palette

// ROLE MAP — which palette role feeds which shadcn variable. The single place
// to retune the bridge. Values are [light, dark].
// Installing a shadcn component that references a NEW token (e.g. bg-sidebar,
// chart-*) requires extending VARS + the @theme inline map first — Tailwind v4
// silently generates nothing for unmapped tokens.
const VARS: Record<string, [string, string]> = {
    background: [color(p.surface.base.light), color(p.surface.base.dark)],
    foreground: [color(p.text.primary.light), color(p.text.primary.dark)],
    card: [color(p.surface.container.light), color(p.surface.container.dark)],
    "card-foreground": [color(p.text.primary.light), color(p.text.primary.dark)],
    popover: [color(p.surface.elevated.light), color(p.surface.elevated.dark)],
    "popover-foreground": [color(p.text.primary.light), color(p.text.primary.dark)],
    primary: [color(p.accent.primary.light), color(p.accent.primary.dark)],
    // Light primary is brand navy → white text; dark primary is brand yellow →
    // dark text (mirrors componentsDark.Button.primaryColor in palette.ts).
    "primary-foreground": [color(p.surface.white.light), p.componentsDark.Button.primaryColor],
    secondary: [color(p.scales.zinc[1].light), color(p.scales.zinc[1].dark)],
    "secondary-foreground": [color(p.text.primary.light), color(p.text.primary.dark)],
    muted: [color(p.scales.zinc[1].light), color(p.scales.zinc[1].dark)],
    "muted-foreground": [color(p.text.secondary.light), color(p.text.secondary.dark)],
    // Dark accent is a NEUTRAL step, not controlItemBgActive.dark (#57572a):
    // shadcn `accent` drives ghost/outline hover fills and the skeleton base.
    // The selection-tint yellow stays desktop-only; introduce a separate token
    // if a selected-state tint is needed later.
    accent: [color(p.surface.controlItemBgActive.light), color(p.scales.zinc[2].dark)],
    "accent-foreground": [color(p.text.primary.light), color(p.text.primary.dark)],
    destructive: [color(p.semantic.error.light), color(p.semantic.error.dark)],
    // Not a shadcn role: session liveness needs a third state between the accent (a turn is
    // running, act on it) and muted (ended). Same semantic family the desktop uses for "healthy".
    success: [color(p.semantic.success.light), color(p.semantic.success.dark)],
    // Bright-red fill gets dark text in dark mode, matching the primary treatment.
    "destructive-foreground": [color(p.surface.white.light), p.componentsDark.Button.primaryColor],
    border: [color(p.border.secondary.light), color(p.border.secondary.dark)],
    input: [color(p.border.default.light), color(p.border.default.dark)],
    ring: [color(p.accent.primary.light), color(p.accent.primary.dark)],
}

// ── @agenta/ui control tokens ────────────────────────────────────────────────
// The shared components in @agenta/ui speak the palette-derived vocabulary the desktop
// generates (btn-*, error-*, disabled-*). Same palette.ts, same values — only the names
// differ from the shadcn roles above, so both live in one generated file.
const UI_VARS: Record<string, [string, string]> = {
    "btn-primary-hover": [color(p.button.primaryHover.light), color(p.button.primaryHover.dark)],
    "btn-primary-active": [color(p.button.primaryActive.light), color(p.button.primaryActive.dark)],
    "btn-primary-fg": [color(p.button.primaryText.light), color(p.button.primaryText.dark)],
    "btn-default-bg": [color(p.button.defaultBg.light), color(p.button.defaultBg.dark)],
    "btn-default-hover-bg": [
        color(p.button.defaultHoverBg.light),
        color(p.button.defaultHoverBg.dark),
    ],
    "btn-default-active-bg": [
        color(p.button.defaultActiveBg.light),
        color(p.button.defaultActiveBg.dark),
    ],
    "btn-text-hover-bg": [color(p.button.textHoverBg.light), color(p.button.textHoverBg.dark)],
    "btn-text-active-bg": [color(p.button.textActiveBg.light), color(p.button.textActiveBg.dark)],
    "btn-link": [color(p.button.link.light), color(p.button.link.dark)],
    "btn-link-hover": [color(p.button.linkHover.light), color(p.button.linkHover.dark)],
    "btn-link-active": [color(p.button.linkActive.light), color(p.button.linkActive.dark)],
    error: [color(p.semantic.error.light), color(p.semantic.error.dark)],
    "error-hover": [color(p.semantic.errorHover.light), color(p.semantic.errorHover.dark)],
    "error-active": [color(p.semantic.errorActive.light), color(p.semantic.errorActive.dark)],
    disabled: [color(p.text.disabled.light), color(p.text.disabled.dark)],
    "focus-ring": [color(p.semantic.primaryBorder.light), color(p.semantic.primaryBorder.dark)],
    "disabled-bg": [
        color(p.surface.containerDisabled.light),
        color(p.surface.containerDisabled.dark),
    ],
}

// ── Control geometry ─────────────────────────────────────────────────────────
// Straight from the shared controlScale module (web/oss/src/styles/theme/controlScale.ts) —
// the same object oss spreads into its Tailwind v3 theme. Emitted into Tailwind v4's own
// namespaces so a shared component renders at identical dimensions in both apps, and a retune
// there reaches mobile through this generator instead of a hand-copied pixel list.

const geometry = (): string => {
    const out: string[] = []
    const push = (ns: string, table: Record<string, unknown>) => {
        for (const [name, value] of Object.entries(table)) {
            // fontSize entries are [size, {lineHeight}] tuples; the rest are plain strings.
            const size = Array.isArray(value) ? (value[0] as string) : (value as string)
            out.push(`    --${ns}-${name}: ${size};`)
        }
    }
    push("height", controlScale.height)
    push("width", controlScale.width)
    push("spacing", controlScale.spacing)
    push("radius", controlScale.borderRadius)
    push("text", controlScale.fontSize)
    return out.join("\n")
}

// ── @agenta/ui colour surface ────────────────────────────────────────────────
// The shared components speak the desktop's palette-derived `--ag-*` vocabulary. Rather than
// curating a per-component list, mirror the layer itself: read the generated variables, keep
// the ones @agenta/ui references, and expose each under Tailwind v4's colour namespace.
//
// Source is theme-variables.css, not palette.ts, because many values are antd-algorithm output
// (derived fills, preset tag ramps) that palette.ts cannot reproduce on its own. Both files come
// from the same generator run, so this stays one source of truth.
const AG_CSS = resolve(HERE, "../../oss/src/styles/theme-variables.css")

/**
 * Flatten the shared contract into utility-name → variable-name.
 *
 * Tailwind nests families (`{primary: {DEFAULT, hover}}` → `primary`, `primary-hover`), so the
 * same flattening the v3 config gets for free has to happen explicitly here.
 */
const flattenTokens = (
    node: unknown,
    prefix = "",
    out: Record<string, string> = {},
): Record<string, string> => {
    if (typeof node === "string") {
        const m = node.match(/^var\(--ag-([A-Za-z0-9-]+)\)$/)
        if (m && prefix) out[prefix] = m[1]
        return out
    }
    if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            const name = key === "DEFAULT" ? prefix : prefix ? `${prefix}-${key}` : key
            flattenTokens(value, name, out)
        }
    }
    return out
}

const TOKEN_TO_VAR = flattenTokens(shadcnTokens)

/**
 * Utility names the shared components actually reference. Scanned rather than enumerated so a
 * new component cannot silently render unstyled: whatever it uses, the bridge emits.
 */
const usedNames = (): string[] => {
    const dir = resolve(HERE, "../../packages/agenta-ui/src")
    const names = new Set<string>()
    const walk = (d: string) => {
        for (const entry of readdirSync(d, {withFileTypes: true})) {
            const full = resolve(d, entry.name)
            if (entry.isDirectory()) walk(full)
            else if (/\.tsx?$/.test(entry.name)) {
                for (const m of readFileSync(full, "utf8").matchAll(
                    /\b(?:bg|text|border|ring|fill|stroke|outline|from|to|via|decoration|shadow|divide|accent|caret|placeholder)-([a-zA-Z][a-zA-Z0-9-]*)/g,
                )) {
                    names.add(m[1])
                }
            }
        }
    }
    walk(dir)
    return [...names]
}

const parseAgVars = (): {light: Record<string, string>; dark: Record<string, string>} => {
    const css = readFileSync(AG_CSS, "utf8")
    const grab = (selector: string): Record<string, string> => {
        const start = css.indexOf(`${selector} {`)
        if (start < 0) throw new Error(`${selector} block missing from theme-variables.css`)
        const body = css.slice(start, css.indexOf("\n}", start))
        const out: Record<string, string> = {}
        for (const line of body.split("\n")) {
            const m = line.match(/^\s*--ag-([A-Za-z0-9-]+):\s*(.+);\s*$/)
            if (m) out[m[1]] = m[2].trim()
        }
        return out
    }
    return {light: grab(":root"), dark: grab(".dark")}
}

/** Which `--ag-*` names the shared components reference, read from their own source. */
const usedAgNames = (): string[] => {
    const dir = resolve(HERE, "../../packages/agenta-ui/src")
    const names = new Set<string>()
    const walk = (d: string) => {
        for (const entry of readdirSync(d, {withFileTypes: true})) {
            const full = resolve(d, entry.name)
            if (entry.isDirectory()) walk(full)
            else if (/\.tsx?$/.test(entry.name)) {
                const src = readFileSync(full, "utf8")
                for (const m of src.matchAll(
                    /\b(?:bg|text|border|ring|fill|stroke|outline|from|to|via|decoration|shadow)-([a-zA-Z][a-zA-Z0-9-]*)/g,
                )) {
                    names.add(m[1])
                }
            }
        }
    }
    walk(dir)
    return [...names]
}

const block = (selector: string, side: 0 | 1) =>
    `${selector} {\n${Object.entries({...VARS, ...UI_VARS})
        .map(([name, pair]) => `    --${name}: ${pair[side]};`)
        .join("\n")}\n}\n`

// Colour surface: `--name` per theme, plus the v4 namespace mapping. Only names that resolve to
// a real variable are emitted — an unmapped utility would silently generate nothing anyway.
const ag = parseAgVars()
// The contract wins where it renames a token; anything else the package references maps to the
// variable of the same name.
const agResolved = [...new Set([...Object.keys(TOKEN_TO_VAR), ...usedNames()])]
    .map((name) => ({name, varName: TOKEN_TO_VAR[name] ?? name}))
    .filter(({varName}) => ag.light[varName] !== undefined)

const agBlock = (side: "light" | "dark") =>
    agResolved.map(({name, varName}) => `    --${name}: ${ag[side][varName]};`).join("\n")

const agTheme = () => agResolved.map(({name}) => `    --color-${name}: var(--${name});`).join("\n")

const css = `/* GENERATED by scripts/generate-shadcn-tokens.ts — DO NOT EDIT.
 * Source of truth: web/oss/src/styles/theme/palette.ts
 * Regenerate: pnpm --filter @agenta/mobile generate:tokens
 */
:root {
${agBlock("light")}
}
.dark {
${agBlock("dark")}
}
${block(":root", 0)}
${block(".dark", 1)}
@theme {
${agTheme()}
${geometry()}
}
`

// --check: drift guard — fail (without writing) if the committed file is stale.
if (process.argv.includes("--check")) {
    let existing: string | null = null
    try {
        existing = readFileSync(OUT, "utf8")
    } catch {
        existing = null
    }
    if (existing !== css) {
        console.error(
            "theme.generated.css is stale — run pnpm --filter @agenta/mobile generate:tokens",
        )
        process.exit(1)
    }
    process.exit(0)
}

writeFileSync(OUT, css)
console.log(`wrote ${OUT}`)
