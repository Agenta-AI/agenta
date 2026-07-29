/**
 * generate-tailwind-tokens.ts — emit theme artifacts from the single source of
 * truth (oss/src/styles/theme/palette.ts).
 *
 * Emits (all palette-driven): the full theme-variables.css (core semantic + scales
 * + alpha + feature families + the legacy --ag-c-* shim aliased to roles) and the
 * antd dark-overrides module. Inputs are palette.ts + legacy-shim.ts only; the live
 * theme-variables.css is read solely by the parity harness to verify losslessness.
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

import {legacyShim} from "../oss/src/styles/theme/legacy-shim"
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

// antd token overrides applied on top of darkAlgorithm, DERIVED from palette (never
// hand-copied) so palette.ts stays the single source of truth: editing a dark value
// there flows into both the algorithm input below AND the emitted DARK_TOKEN_OVERRIDES
// (buildAntdOverrides reuses this object). Includes the shadow overrides so antdDark
// resolves --ant-box-shadow-* the way the app actually renders them.
const DARK_TOKEN_OVERRIDES: Record<string, string> = {
    colorPrimary: palette.accent.primary.dark as string,
    colorLink: palette.accent.link.dark as string,
    colorLinkHover: palette.accent.linkHover.dark as string,
    colorLinkActive: palette.accent.linkActive.dark as string,
    colorSuccess: palette.semantic.success.dark as string,
    colorWarning: palette.semantic.warning.dark as string,
    colorError: palette.semantic.error.dark as string,
    colorBgElevated: palette.surface.elevated.dark as string,
    colorTextPlaceholder: palette.text.placeholder.dark as string,
    boxShadow: palette.shadow.overlay.dark as string,
    boxShadowSecondary: palette.shadow.overlay.dark as string,
    boxShadowTertiary: palette.shadow.tertiary.dark as string,
    boxShadowDrawerRight: palette.shadow.drawerRight.dark as string,
    boxShadowDrawerLeft: palette.shadow.drawerLeft.dark as string,
    boxShadowDrawerTop: palette.shadow.drawerTop.dark as string,
    boxShadowDrawerBottom: palette.shadow.drawerBottom.dark as string,
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
const asCss = (v: ColorValue): string => (typeof v === "string" ? v : `/* antd:${v.antd} */`) // antd() only on light shadows (not emitted as vars)

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
    ["colorWarningBg", palette.semantic.warningBg],
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

// ---------------------------------------------------------------------------
// SHIM — legacy --ag-c-* codemod tokens (frozen in legacy-shim.ts). Light = the
// original hex; dark is ALIASED to a core role wherever it resolves to that role's
// value (so editing a role propagates to legacy classes — this is where the 30
// light tokens collapse onto one dark surface role), else kept literal.
// ---------------------------------------------------------------------------
let shimAliased = 0
function buildShim() {
    const root: string[] = []
    const dark: string[] = []
    for (const [name, {light, dark: d}] of Object.entries(legacyShim)) {
        if (light != null) root.push(`    ${name}: ${light};`)
        if (d != null) {
            const a = aliasDark(d)
            if (a.aliased) shimAliased++
            dark.push(`    ${name}: ${a.value};`)
        }
    }
    return {root: root.join("\n"), dark: dark.join("\n")}
}

// ---------------------------------------------------------------------------
// FEATURE FAMILIES — palette-driven (ref/env/cmp/type/surface/composer/status/
// drawer/app-variant), mapped to their existing --ag var names.
// ---------------------------------------------------------------------------
interface FVal {
    light?: string
    dark?: string
}
const s = (v: ColorValue) => asCss(v)
const pairOf = (p: Pair): FVal => ({light: s(p.light), dark: s(p.dark)})
const camelToKebab = (k: string) => k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())

const SURFACE_NAME: Record<string, string> = {
    app: "app",
    gutter: "gutter",
    divider: "divider",
    raised: "raised",
    card: "card",
    cardBorder: "card-border",
    inset: "inset",
    insetBorder: "inset-border",
    canvas: "canvas",
    chat: "chat",
    chatBorder: "chat-border",
    chip: "chip",
    chipBorder: "chip-border",
    rowHover: "row-hover",
    accent: "accent",
    raisedShadow: "raised-shadow",
    cardShadow: "card-shadow",
    chatShadow: "chat-shadow",
    inspectorShadow: "inspector-shadow",
}
const pf = palette
const FEATURES: [string, FVal][] = [
    ...Object.entries(pf.referenceTag).flatMap(([t, x]) => [
        [`ref-${t}-text`, pairOf(x.text)] as [string, FVal],
        [`ref-${t}-bg`, pairOf(x.bg)] as [string, FVal],
        [`ref-${t}-border`, pairOf(x.border)] as [string, FVal],
    ]),
    ...Object.entries(pf.environmentTag).flatMap(([t, x]) => [
        [`env-${t}-text`, pairOf(x.text)] as [string, FVal],
        [`env-${t}-bg`, pairOf(x.bg)] as [string, FVal],
        [`env-${t}-border`, pairOf(x.border)] as [string, FVal],
    ]),
    ...Object.entries(pf.compareTint).map(
        ([n, p]) => [`cmp-tint-${n}`, pairOf(p)] as [string, FVal],
    ),
    ...Object.entries(pf.workflowType).flatMap(([k, x]) => [
        [`type-${k}-bg`, {dark: x.bg}] as [string, FVal],
        [`type-${k}-text`, {dark: x.text}] as [string, FVal],
    ]),
    ...Object.entries(pf.playgroundSurface).map(
        ([k, p]) => [`surface-${SURFACE_NAME[k]}`, pairOf(p)] as [string, FVal],
    ),
    ["composer-border", pairOf(pf.composer.border)],
    ["composer-focus", pairOf(pf.composer.focus)],
    ["composer-placeholder", pairOf(pf.composer.placeholder)],
    ["send-disabled-bg", pairOf(pf.composer.sendDisabledBg)],
    ["send-disabled-fg", pairOf(pf.composer.sendDisabledFg)],
    ["user-bubble-bg", pairOf(pf.composer.userBubbleBg)],
    ["user-bubble-border", pairOf(pf.composer.userBubbleBorder)],
    ["app-variant-row", pairOf(pf.appVariantCell.row)],
    ["app-variant-label", pairOf(pf.appVariantCell.label)],
    ["app-variant-chip-bg", pairOf(pf.appVariantCell.chipBg)],
    ["status-error-bg", pairOf(pf.status.errorBg)],
    ["status-error-border", pairOf(pf.status.errorBorder)],
    ["status-error-text", pairOf(pf.status.errorText)],
    ["status-success-bg", pairOf(pf.status.successBg)],
    ["status-success-border", pairOf(pf.status.successBorder)],
    ["status-success-text", pairOf(pf.status.successText)],
    ["surface-error-well", pairOf(pf.status.errorWell)],
    ["surface-error-well-border", pairOf(pf.status.errorWellBorder)],
    ...Object.entries(pf.drawerDark).map(
        ([k, v]) => [`drawer-${camelToKebab(k)}`, {dark: v as string}] as [string, FVal],
    ),
    ["strip-input-border", pairOf(pf.templateStrip.inputBorder)],
    ["strip-selected-bg", pairOf(pf.templateStrip.selectedBg)],
    ["strip-card-bg", pairOf(pf.templateStrip.cardBg)],
    ["strip-card-border", pairOf(pf.templateStrip.cardBorder)],
    ["strip-card-border-hover", pairOf(pf.templateStrip.cardBorderHover)],
    ["strip-card-hover-shadow", pairOf(pf.templateStrip.cardHoverShadow)],
    ["shell-rail-bg", pairOf(pf.shell.railBg)],
    ["shell-line", pairOf(pf.shell.line)],
    ["scroll-thumb", pairOf(pf.shell.scrollThumb)],
    ["scroll-thumb-hover", pairOf(pf.shell.scrollThumbHover)],
    ["sidebar-bg", {light: "var(--ag-shell-rail-bg)", dark: "var(--ag-shell-rail-bg)"}],
]

// Emit feature vars. A constant token (light === dark, e.g. surface-accent) is
// emitted in :root only, matching the current file (it cascades into .dark).
function buildFeatures() {
    const root: string[] = []
    const dark: string[] = []
    for (const [name, v] of FEATURES) {
        // A literal constant (e.g. surface-accent #c2d54a) lives in :root only and
        // cascades into .dark. A var() ref that mirrors a role is declared in both.
        const literalConstant = v.light != null && v.light === v.dark && !v.light.startsWith("var(")
        if (v.light != null) root.push(`    --ag-${name}: ${v.light};`)
        if (v.dark != null && !literalConstant) dark.push(`    --ag-${name}: ${v.dark};`)
    }
    return {root: root.join("\n"), dark: dark.join("\n")}
}

function buildCss(): string {
    const shim = buildShim()
    const feat = buildFeatures()
    return `/* GENERATED by scripts/generate-tailwind-tokens.ts — do not edit by hand.
   Source of truth: oss/src/styles/theme/palette.ts (+ legacy-shim.ts for --ag-c-*).
   Everything here is palette-driven; the shim aliases legacy tokens to roles. */

:root {
    /* --- core semantic --- */
${rootBlock(CORE)}

    /* --- scales --- */
${rootBlock(RAMPS)}

    /* --- alpha fills --- */
${rootBlock(ALPHA)}

    /* --- feature families --- */
${feat.root}

    /* --- legacy --ag-c-* shim (light = original hex) --- */
${shim.root}
}

.dark {
    /* --- core semantic --- */
${coreDarkBlock(CORE)}

    /* --- scales --- */
${darkBlock(RAMPS)}

    /* --- alpha fills --- */
${darkBlock(ALPHA)}

    /* --- feature families --- */
${feat.dark}

    /* --- legacy --ag-c-* shim (dark aliased to roles where possible) --- */
${shim.dark}
}
`
}

// ---------------------------------------------------------------------------
// antd dark-overrides module — the values ThemeContextProvider imports instead
// of hand-maintaining DARK_TOKEN_OVERRIDES/darkComponents.
// ---------------------------------------------------------------------------
function buildAntdOverrides(): string {
    const p = palette
    // Same palette-derived object the darkAlgorithm is seeded with — emitting it here is
    // exactly what ThemeContextProvider imports, so the CSS-var layer and the antd-config
    // layer can never diverge.
    const o = DARK_TOKEN_OVERRIDES
    // Emit prettier-conformant TS (unquoted keys, trailing commas) so the generated
    // file stays lint-clean and doesn't churn against format-fix.
    // Match prettier: wrap the value onto its own indented line when the single-line
    // form would exceed printWidth (100).
    const flat = (obj: Record<string, string>, indent: string) =>
        Object.entries(obj)
            .map(([k, v]) => {
                const json = JSON.stringify(v)
                const line = `${indent}${k}: ${json},`
                return line.length > 100 ? `${indent}${k}:\n${indent}    ${json},` : line
            })
            .join("\n")
    const nested = Object.entries(p.componentsDark)
        .map(([name, tokens]) => `    ${name}: {\n${flat(tokens, "        ")}\n    },`)
        .join("\n")
    return `// GENERATED from palette.ts by scripts/generate-tailwind-tokens.ts — do not edit by hand.
export const DARK_TOKEN_OVERRIDES = {
${flat(o, "    ")}
}

export const darkComponents = {
${nested}
}
`
}

// ---------------------------------------------------------------------------
// Parity harness — parse the current file, compare resolved values.
// ---------------------------------------------------------------------------
function parseThemeCss(text: string) {
    const root = new Map<string, string>()
    const dark = new Map<string, string>()
    let scope: "root" | "dark" | null = null
    let buf: string | null = null // accumulate multi-line values (e.g. wrapped rgba())
    let bufName: string | null = null
    for (const line of text.split("\n")) {
        if (buf != null) {
            buf += " " + line.trim()
            if (line.includes(";")) {
                const val = buf.split(":").slice(1).join(":").split(";")[0].trim()
                if (scope) (scope === "root" ? root : dark).set(bufName as string, val)
                buf = bufName = null
            }
            continue
        }
        const open = line.match(/^\s*(:root|\.dark)\s*\{/)
        if (open) {
            scope = open[1] === ":root" ? "root" : "dark"
            continue
        }
        if (/^\s*\}/.test(line)) {
            scope = null
            continue
        }
        const decl = line.match(/^\s*(--ag-[a-z0-9-]+)\s*:\s*(.*)$/i)
        if (decl && scope) {
            if (decl[2].includes(";"))
                (scope === "root" ? root : dark).set(decl[1], decl[2].split(";")[0].trim())
            else {
                buf = `${decl[1]}: ${decl[2]}`
                bufName = decl[1]
            }
        }
    }
    return {root, dark}
}

function parityCheck(generatedCss: string, baselineText: string) {
    const cur = parseThemeCss(baselineText)
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
    const uncovered = [...cur.root.keys()].filter((k) => !gen.root.has(k))
    const darkUncovered = [...cur.dark.keys()].filter((k) => !gen.dark.has(k))
    return {checked, mismatches, lightMismatches, uncovered, darkUncovered}
}

// ---------------------------------------------------------------------------
// Main
//   GEN_WRITE=1        → write the LIVE files (theme-variables.css + overrides).
//                        Otherwise write to the scratch OUT dir (safe default).
//   BASELINE_CSS=path  → verify the generated CSS is lossless vs this frozen
//                        baseline. Omit for a plain regen (no parity, e.g. after
//                        the designer intentionally changes palette.ts).
// ---------------------------------------------------------------------------
const WRITE = process.env.GEN_WRITE === "1"
const cssTarget = WRITE ? CURRENT_CSS : pathResolve(OUT, "theme-variables.generated.css")
const overridesTarget = WRITE
    ? pathResolve(OSS, "src/styles/theme/antd-overrides.generated.ts")
    : pathResolve(OUT, "antd-dark-overrides.generated.ts")

const css = buildCss()
if (!WRITE) mkdirSync(OUT, {recursive: true})
writeFileSync(cssTarget, css)
writeFileSync(overridesTarget, buildAntdOverrides())
console.log(`\nWrote:\n  ${cssTarget}\n  ${overridesTarget}`)

if (process.env.BASELINE_CSS) {
    const baselineText = readFileSync(pathResolve(WEB, process.env.BASELINE_CSS), "utf8")
    const {checked, mismatches, lightMismatches, uncovered, darkUncovered} = parityCheck(
        css,
        baselineText,
    )
    console.log(`\nPARITY (vs ${process.env.BASELINE_CSS})`)
    console.log(`  dark values checked:  ${checked}`)
    console.log(`  dark mismatches:      ${mismatches.length}`)
    console.log(`  light mismatches:     ${lightMismatches.length}`)
    console.log(`  --ag-c-* dark aliased: ${shimAliased}`)
    console.log(`  baseline root vars NOT emitted: ${uncovered.length}`)
    console.log(`  baseline dark vars NOT emitted: ${darkUncovered.length}`)
    if (mismatches.length) console.log("\nDARK MISMATCHES:\n" + mismatches.slice(0, 40).join("\n"))
    if (lightMismatches.length)
        console.log("\nLIGHT MISMATCHES:\n" + lightMismatches.slice(0, 40).join("\n"))
    if (uncovered.length) console.log("\nROOT UNCOVERED:\n  " + uncovered.join("\n  "))
    if (darkUncovered.length) console.log("\nDARK UNCOVERED:\n  " + darkUncovered.join("\n  "))
} else {
    console.log("\n(no BASELINE_CSS → skipped parity; plain regen)")
}
