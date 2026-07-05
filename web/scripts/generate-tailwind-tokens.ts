/**
 * generate-tailwind-tokens.ts — emit theme artifacts from the single source of
 * truth (oss/src/styles/theme/palette.ts).
 *
 * v1 SCOPE (this pass): core antd-semantic --ag-color* vars + the role-inverted
 * scales + the --ag-rgba-* alpha fills, plus the antd dark-overrides module and
 * the tailwind color map. Feature families (ref / surface / env tokens) and the
 * ag-c codemod shim are NOT emitted yet — they're passthrough today and are the
 * next increment. See TODO(features) / TODO(shim).
 *
 * SAFETY: writes to $GEN_OUT (default: a scratch dir), never the live
 * theme-variables.css, so it can't collide with in-flight edits. Pass
 * GEN_OUT=oss/src/styles to actually regenerate (Phase 3, when the tree is quiet).
 *
 * Run: pnpm --filter web exec tsx scripts/generate-tailwind-tokens.ts   (from web/)
 */
import {readFileSync, writeFileSync, mkdirSync} from "fs"
import {createRequire} from "module"
import {dirname, resolve as pathResolve} from "path"
import {fileURLToPath} from "url"

import {palette, type ColorValue, type Pair} from "../oss/src/styles/theme/palette"

const HERE = dirname(fileURLToPath(import.meta.url)) // web/scripts
const WEB = pathResolve(HERE, "..") // web
const OSS = pathResolve(WEB, "oss")
const CURRENT_CSS = pathResolve(OSS, "src/styles/theme-variables.css")
const OUT = process.env.GEN_OUT
    ? pathResolve(WEB, process.env.GEN_OUT)
    : pathResolve(process.env.SCRATCH || "/tmp", "theme-gen")

// ---------------------------------------------------------------------------
// antd dark token map — replicate ThemeContextProvider's dark config exactly so
// we can (a) sanity-check the snapshot and (b) resolve var(--ant-*) refs when
// diffing against the current file.
// ---------------------------------------------------------------------------
const req = createRequire(OSS + "/package.json")
const antdTheme = req("antd/lib/theme").default
const antdTokens = req("./src/styles/tokens/antd-themeConfig.json")

const isColorValue = (v: unknown): v is string =>
    typeof v === "string" && /^(#|rgba?\(|hsla?\()/.test(v.trim())
const stripColors = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => !isColorValue(v)))
const stripComponentColors = (c: Record<string, Record<string, unknown>>) =>
    Object.fromEntries(Object.entries(c).map(([n, t]) => [n, stripColors(t)]))

// Mirror DARK_TOKEN_OVERRIDES exactly (kept in sync with ThemeContextProvider.tsx)
// — including the shadow overrides, so antdDark resolves --ant-box-shadow-* the
// way the app actually renders them.
const OVERLAY_SHADOW =
    "0 0 0 1px rgba(255, 255, 255, 0.16), 0 6px 16px 0 rgba(0, 0, 0, 0.44), 0 3px 6px -4px rgba(0, 0, 0, 0.52), 0 9px 28px 8px rgba(0, 0, 0, 0.28)"
const DARK_TOKEN_OVERRIDES = {
    colorPrimary: "#f2f25c",
    colorSuccess: "#52c41a",
    colorWarning: "#faad14",
    colorError: "#ff4d4f",
    colorLink: "#58a6ff",
    colorLinkHover: "#79b8ff",
    colorLinkActive: "#3b8eea",
    boxShadow: OVERLAY_SHADOW,
    boxShadowSecondary: OVERLAY_SHADOW,
    boxShadowTertiary:
        "0 0 0 1px rgba(255, 255, 255, 0.12), 0 1px 2px 0 rgba(0, 0, 0, 0.30), 0 1px 6px -1px rgba(0, 0, 0, 0.20), 0 2px 4px 0 rgba(0, 0, 0, 0.20)",
    colorBgElevated: "#242424",
    colorTextPlaceholder: "rgba(255, 255, 255, 0.38)",
}

// antd SEED tokens: setting them feeds the algorithm, which DERIVES a different
// output. Their --ag CSS var must carry the derived output (what the app renders),
// while the seed flows into the antd overrides. Everything else: css var == value.
const SEED_TOKENS = new Set(["colorPrimary", "colorSuccess", "colorWarning", "colorError"])
const antdDark: Record<string, string> = antdTheme.getDesignToken({
    algorithm: antdTheme.darkAlgorithm,
    token: {
        ...stripColors(antdTokens.token),
        ...stripComponentColors(antdTokens.components),
        ...DARK_TOKEN_OVERRIDES,
    },
})

const kebabToCamel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())
const expandHex3 = (s: string) =>
    s.replace(/#([0-9a-f])([0-9a-f])([0-9a-f])\b/gi, (_, r, g, b) => `#${r}${r}${g}${g}${b}${b}`)
const norm = (s: string) => expandHex3(s.trim().toLowerCase()).replace(/\s+/g, "")

// Resolved dark value of each owned --ag role var (filled after CORE/RAMPS/ALPHA).
const agDark = new Map<string, string>()

/** Resolve a CSS value that may reference antd or --ag role vars to a comparable string. */
function resolveValue(expr: string): string {
    const t = expr.trim()
    const ant = t.match(/^var\(\s*(--ant-[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/i)
    if (ant) {
        const camel = kebabToCamel(ant[1].replace(/^--ant-/, ""))
        const hit = antdDark[camel]
        if (hit) return norm(hit)
        if (ant[2]) return norm(ant[2]) // fallback literal
        return norm(expr)
    }
    const ag = t.match(/^var\(\s*(--ag-[a-z0-9-]+)\s*\)$/i)
    if (ag) {
        const hit = agDark.get(ag[1])
        if (hit != null) return resolveValue(hit)
    }
    return norm(expr)
}

// ---------------------------------------------------------------------------
// Emit helpers
// ---------------------------------------------------------------------------
const asCss = (v: ColorValue): string =>
    typeof v === "string" ? v : `/* antd:${v.antd} */` // antd() only on light shadows (not emitted as vars)

type Row = [cssVar: string, pair: Pair]

/** Core --ag-color* vars, mapped to their antd token names (the light seed order). */
const CORE: Row[] = [
    ["colorText", palette.text.primary],
    ["colorTextSecondary", palette.text.secondary],
    ["colorTextTertiary", palette.text.tertiary],
    ["colorTextQuaternary", palette.text.quaternary],
    ["colorTextHeading", palette.text.heading],
    ["colorTextLabel", palette.text.label],
    ["colorTextDescription", palette.text.description],
    ["colorTextDisabled", palette.text.disabled],
    ["colorTextPlaceholder", palette.text.placeholder],
    ["colorTextLightSolid", palette.text.lightSolid],
    ["colorIcon", palette.text.icon],
    ["colorIconHover", palette.text.iconHover],
    ["colorBgContainer", palette.surface.container],
    ["colorBgElevated", palette.surface.elevated],
    ["colorBgLayout", palette.surface.layout],
    ["colorBgBase", palette.surface.base],
    ["colorBgSpotlight", palette.surface.spotlight],
    ["colorBgMask", palette.surface.mask],
    ["colorBorder", palette.border.default],
    ["colorBorderSecondary", palette.border.secondary],
    ["colorFill", palette.fill.fill],
    ["colorFillSecondary", palette.fill.secondary],
    ["colorFillTertiary", palette.fill.tertiary],
    ["colorFillQuaternary", palette.fill.quaternary],
    ["colorSplit", palette.border.split],
    ["colorPrimary", palette.accent.primary],
    ["colorPrimaryText", palette.accent.primaryText],
    ["colorSuccess", palette.semantic.success],
    ["colorWarning", palette.semantic.warning],
    ["colorWarningText", palette.semantic.warningText],
    ["colorErrorText", palette.semantic.errorText],
    ["colorError", palette.semantic.error],
    ["colorErrorBorder", palette.semantic.errorBorder],
    ["colorInfo", palette.semantic.info],
    ["colorInfoBorder", palette.semantic.infoBorder],
    ["colorSuccessBorder", palette.semantic.successBorder],
    ["colorWarningBorder", palette.semantic.warningBorder],
    ["colorBgContainerDisabled", palette.surface.containerDisabled],
    ["colorInfoBg", palette.surface.infoBg],
    ["controlItemBgActive", palette.surface.controlItemBgActive],
    ["colorWhite", palette.surface.white],
    ["boxShadowTertiary", palette.shadow.tertiary],
]

function rampRows(prefix: string, ramp: Record<number, Pair>): Row[] {
    return Object.entries(ramp).map(([k, pair]) => [`${prefix}-${k}`, pair] as Row)
}
const RAMPS: Row[] = [
    ...rampRows("zinc", palette.scales.zinc),
    ...rampRows("gray", palette.scales.gray),
    ...rampRows("aggray", palette.scales.agGray),
    ...rampRows("neutral", palette.scales.neutral as Record<number, Pair>),
    ...rampRows("slate", palette.scales.slate as Record<number, Pair>),
]
const ALPHA: Row[] = Object.entries(palette.alphaFill).map(
    ([k, pair]) => [`rgba-${k}`, pair] as Row,
)

const coreDark = (name: string, p: Pair): string =>
    SEED_TOKENS.has(name) ? antdDark[name] : asCss(p.dark)

const rootBlock = (rows: Row[]) =>
    rows.map(([name, p]) => `    --ag-${name}: ${asCss(p.light)};`).join("\n")
const darkBlock = (rows: Row[]) =>
    rows.map(([name, p]) => `    --ag-${name}: ${asCss(p.dark)};`).join("\n")
const coreDarkBlock = (rows: Row[]) =>
    rows.map(([name, p]) => `    --ag-${name}: ${coreDark(name, p)};`).join("\n")

// ---------------------------------------------------------------------------
// SHIM + PASSTHROUGH — the legacy --ag-c-* codemod tokens and the feature-family
// blocks aren't roles, so they're sourced from the current file (read once) and
// re-emitted. The --ag-c-* dark values are ALIASED to a core role wherever they
// resolve to that role's value, so editing a role propagates to legacy classes
// (this is where 25 distinct light tokens collapse onto one dark surface role).
// Everything else is copied verbatim (lossless). Later increment: fold feature
// families into palette.ts so they're palette-driven, not passthrough.
// ---------------------------------------------------------------------------
const current = parseThemeCss(readFileSync(CURRENT_CSS, "utf8"))
const OWNED = new Set([...CORE, ...RAMPS, ...ALPHA].map(([n]) => `--ag-${n}`))

// Fill the role-var → dark-value index the resolver uses for --ag refs.
for (const [n, p] of CORE) agDark.set(`--ag-${n}`, coreDark(n, p))
for (const [n, p] of [...RAMPS, ...ALPHA]) agDark.set(`--ag-${n}`, asCss(p.dark))

// Reverse index: resolved dark value → the core --ag role var that carries it.
const reverseDark = new Map<string, string>()
for (const [name, p] of CORE) {
    const key = resolveValue(coreDark(name, p))
    if (key && !reverseDark.has(key)) reverseDark.set(key, `--ag-${name}`)
}
const aliasDark = (curDark: string): {value: string; aliased: boolean} => {
    const role = reverseDark.get(resolveValue(curDark))
    return role ? {value: `var(${role})`, aliased: true} : {value: curDark, aliased: false}
}

let shimAliased = 0
function shimAndPassthrough() {
    const names = new Set([...current.root.keys(), ...current.dark.keys()])
    const shimRoot: string[] = []
    const shimDark: string[] = []
    const passRoot: string[] = []
    const passDark: string[] = []
    for (const name of names) {
        if (OWNED.has(name)) continue
        const light = current.root.get(name)
        const dark = current.dark.get(name)
        if (name.startsWith("--ag-c-")) {
            if (light != null) shimRoot.push(`    ${name}: ${light};`)
            if (dark != null) {
                const a = aliasDark(dark)
                if (a.aliased) shimAliased++
                shimDark.push(`    ${name}: ${a.value};`)
            }
        } else {
            if (light != null) passRoot.push(`    ${name}: ${light};`)
            if (dark != null) passDark.push(`    ${name}: ${dark};`)
        }
    }
    return {
        shimRoot: shimRoot.join("\n"),
        shimDark: shimDark.join("\n"),
        passRoot: passRoot.join("\n"),
        passDark: passDark.join("\n"),
    }
}

function buildCss(): string {
    const s = shimAndPassthrough()
    return `/* GENERATED by scripts/generate-tailwind-tokens.ts — do not edit by hand.
   Source of truth: oss/src/styles/theme/palette.ts
   Owned (palette-driven): core semantic + scales + alpha.
   Shim (--ag-c-*, dark aliased to roles) + feature families: sourced from the
   prior theme-variables.css until folded into palette.ts. */

:root {
    /* --- owned: core semantic --- */
${rootBlock(CORE)}

    /* --- owned: scales --- */
${rootBlock(RAMPS)}

    /* --- owned: alpha fills --- */
${rootBlock(ALPHA)}

    /* --- shim: legacy --ag-c-* (light = original hex) --- */
${s.shimRoot}

    /* --- passthrough: feature families --- */
${s.passRoot}
}

.dark {
    /* --- owned: core semantic --- */
${coreDarkBlock(CORE)}

    /* --- owned: scales --- */
${darkBlock(RAMPS)}

    /* --- owned: alpha fills --- */
${darkBlock(ALPHA)}

    /* --- shim: legacy --ag-c-* (dark aliased to roles where possible) --- */
${s.shimDark}

    /* --- passthrough: feature families --- */
${s.passDark}
}
`
}

// ---------------------------------------------------------------------------
// antd dark-overrides module — the values ThemeContextProvider imports instead
// of hand-maintaining DARK_TOKEN_OVERRIDES/darkComponents.
// ---------------------------------------------------------------------------
function buildAntdOverrides(): string {
    const p = palette
    const o = {
        colorPrimary: p.accent.primary.dark,
        colorLink: p.accent.link.dark,
        colorLinkHover: p.accent.linkHover.dark,
        colorLinkActive: p.accent.linkActive.dark,
        colorSuccess: p.semantic.success.dark,
        colorWarning: p.semantic.warning.dark,
        colorError: p.semantic.error.dark,
        colorBgElevated: p.surface.elevated.dark,
        colorTextPlaceholder: p.text.placeholder.dark,
        boxShadow: p.shadow.overlay.dark,
        boxShadowSecondary: p.shadow.overlay.dark,
        boxShadowTertiary: p.shadow.tertiary.dark,
    }
    return `// GENERATED from palette.ts — do not edit by hand.
export const DARK_TOKEN_OVERRIDES = ${JSON.stringify(o, null, 4)} as const
export const darkComponents = ${JSON.stringify(p.componentsDark, null, 4)} as const
`
}

// ---------------------------------------------------------------------------
// Parity harness — parse the current file, compare resolved values.
// ---------------------------------------------------------------------------
function parseThemeCss(text: string) {
    const root = new Map<string, string>()
    const dark = new Map<string, string>()
    let scope: "root" | "dark" | null = null
    for (const line of text.split("\n")) {
        const open = line.match(/^\s*(:root|\.dark)\s*\{/)
        if (open) {
            scope = open[1] === ":root" ? "root" : "dark"
            continue
        }
        if (/^\s*\}/.test(line)) {
            scope = null
            continue
        }
        const decl = line.match(/^\s*(--ag-[a-z0-9-]+)\s*:\s*([^;]+);/i)
        if (decl && scope) (scope === "root" ? root : dark).set(decl[1], decl[2].trim())
    }
    return {root, dark}
}

function parityCheck(generatedCss: string) {
    const cur = parseThemeCss(readFileSync(CURRENT_CSS, "utf8"))
    const gen = parseThemeCss(generatedCss)
    const mismatches: string[] = []
    let checked = 0
    for (const [name, genDark] of gen.dark) {
        const curDark = cur.dark.get(name)
        if (curDark == null) continue // var current file doesn't define in .dark
        checked++
        if (resolveValue(genDark) !== resolveValue(curDark))
            mismatches.push(
                `  ${name}\n     current: ${curDark}  → ${resolveValue(curDark)}\n     generated: ${genDark}  → ${resolveValue(genDark)}`,
            )
    }
    // also light parity
    const lightMismatches: string[] = []
    for (const [name, genLight] of gen.root) {
        const curLight = cur.root.get(name)
        if (curLight == null) continue
        if (norm(genLight) !== norm(curLight))
            lightMismatches.push(`  ${name}: current ${curLight}  vs generated ${genLight}`)
    }
    const emitted = new Set([...gen.root.keys()])
    const uncovered = [...cur.root.keys()].filter((k) => !emitted.has(k))
    return {checked, mismatches, lightMismatches, uncovered}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
mkdirSync(OUT, {recursive: true})
const css = buildCss()
writeFileSync(pathResolve(OUT, "theme-variables.generated.css"), css)
writeFileSync(pathResolve(OUT, "antd-dark-overrides.generated.ts"), buildAntdOverrides())

const {checked, mismatches, lightMismatches, uncovered} = parityCheck(css)
console.log(`\nOutput → ${OUT}`)
console.log(`\nPARITY (full file: owned + shim + passthrough)`)
console.log(`  dark values checked: ${checked}`)
console.log(`  dark mismatches:     ${mismatches.length}`)
console.log(`  light mismatches:    ${lightMismatches.length}`)
console.log(`  --ag-c-* dark aliased to roles: ${shimAliased}`)
console.log(`  current vars NOT emitted: ${uncovered.length}`)
if (mismatches.length) console.log("\nDARK MISMATCHES:\n" + mismatches.slice(0, 30).join("\n"))
if (lightMismatches.length)
    console.log("\nLIGHT MISMATCHES:\n" + lightMismatches.slice(0, 30).join("\n"))
if (uncovered.length) console.log("\nUNCOVERED:\n  " + uncovered.join("\n  "))
