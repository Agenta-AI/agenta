/**
 * Kit token resolver. Maps every `--ag-*` kit token (KIT_TOKENS) onto the host's theme
 * variables (theme-variables.css, antd's cssVar layer, the mobile shadcn layer) so an app in
 * the sandboxed iframe follows the host theme without sharing its stylesheet.
 */
import {KIT_TOKENS, type KitToken} from "@agenta/entities/drive"

export type KitScheme = "light" | "dark"

/** What the assembler injects: every kit token plus the scheme it should paint with. */
export type KitTokens = Record<KitToken, string> & {"color-scheme": KitScheme}

interface TokenSource {
    /** Host variables tried in order; the first non-empty one wins. */
    hosts: readonly string[]
    light: string
    dark: string
}

const FONT_STACK =
    'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

/** Fallbacks are the palette's current values (web/oss/src/styles/theme/palette.ts). */
export const KIT_TOKEN_SOURCES: Record<KitToken, TokenSource> = {
    "--ag-bg": {hosts: ["--ag-colorBgContainer"], light: "#ffffff", dark: "#141414"},
    "--ag-fg": {hosts: ["--ag-colorText"], light: "#242424", dark: "rgba(255, 255, 255, 0.85)"},
    "--ag-muted": {
        hosts: ["--ag-colorTextSecondary"],
        light: "#676770",
        dark: "rgba(255, 255, 255, 0.65)",
    },
    "--ag-line": {hosts: ["--ag-colorBorderSecondary"], light: "#e5e5e3", dark: "#303030"},
    "--ag-accent": {hosts: ["--ag-colorPrimary"], light: "#242424", dark: "#d1d151"},
    "--ag-accent-soft": {hosts: ["--ag-controlItemBgActive"], light: "#f0efed", dark: "#57572a"},
    "--ag-ok": {hosts: ["--ag-colorSuccess"], light: "#2e7d3a", dark: "#49aa19"},
    "--ag-warn": {hosts: ["--ag-colorWarning"], light: "#8a6400", dark: "#d89614"},
    "--ag-crit": {hosts: ["--ag-colorError"], light: "#5e0908", dark: "#dc4446"},
    // The host font is a next/font-private face the iframe cannot load; ship a stable stack.
    "--ag-font": {hosts: [], light: FONT_STACK, dark: FONT_STACK},
    "--ag-radius": {hosts: ["--ant-border-radius", "--radius"], light: "6px", dark: "6px"},
}

const readVar = (style: CSSStyleDeclaration, name: string): string =>
    style.getPropertyValue(name).trim()

/** `.dark` is what the host stamps; `data-theme` and the OS preference are the fallbacks. */
export function resolveKitScheme(root: Element): KitScheme {
    if (root.classList.contains("dark")) return "dark"
    const stamped = (root as HTMLElement).dataset?.theme
    if (stamped === "dark" || stamped === "light") return stamped
    const view = root.ownerDocument?.defaultView
    if (view?.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark"
    return "light"
}

export function resolveKitTokens(root: Element): KitTokens {
    const scheme = resolveKitScheme(root)
    const view = root.ownerDocument?.defaultView
    const style = view?.getComputedStyle(root)
    const out = {"color-scheme": scheme} as KitTokens
    for (const token of KIT_TOKENS) {
        const source = KIT_TOKEN_SOURCES[token]
        let value = ""
        if (style) {
            for (const host of source.hosts) {
                value = readVar(style, host)
                if (value) break
            }
        }
        out[token] = value || source[scheme]
    }
    return out
}

/** Same rules as the stub's sanitiser: names `--[A-Za-z0-9_-]+`, values free of `;{}<>`. */
const isTokenName = (name: string) => name === "color-scheme" || /^--[A-Za-z0-9_-]+$/.test(name)
const isCssSafe = (value: string) => !/[;{}<>]/.test(value)

/** `:root{--ag-bg:#fff;…;color-scheme:light}` — one declaration per entry, unsafe values dropped. */
export function tokensToCss(tokens: Record<string, string>): string {
    const decls: string[] = []
    for (const [name, value] of Object.entries(tokens)) {
        if (!isTokenName(name) || !isCssSafe(value)) continue
        decls.push(`${name}:${value}`)
    }
    return `:root{${decls.join(";")}}`
}
