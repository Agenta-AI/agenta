/**
 * Tokenizes a sandbox path written as BARE PROSE ("I updated /tmp/agenta/mounts/…/README.md") into
 * an `<agenta-file-path>` element the chat renderer resolves against the session drive. Running as
 * a marked extension is what makes it safe: fenced blocks, inline code, and link destinations are
 * already claimed by the time it runs. Only paths inside the mounts match — nothing else can
 * resolve to a drive file.
 */
import {isSandboxPath} from "@agenta/entities/session"
import type {TokenizerAndRendererExtension} from "marked"

/** Characters a path segment may contain: an allowlist of ASCII plus everything above it (an
 * accented or CJK filename is a path like any other). Excludes `<`, `>`, `&`, and quotes, so a
 * matched token is inert HTML and the renderer below can emit it without escaping. */
const isPathChar = (char: string): boolean =>
    (char >= "a" && char <= "z") ||
    (char >= "A" && char <= "Z") ||
    (char >= "0" && char <= "9") ||
    char === "." ||
    char === "_" ||
    char === "-" ||
    char === "+" ||
    char === "@" ||
    char === "~" ||
    char.charCodeAt(0) > 127

/** Trailing characters that punctuate a path rather than belong to it ("…/README.md.", "…/src/"). */
const TRAILING = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", ">", "'", '"', "/"])

/** Longest plausible mention — a guard against a pathological token, not a real limit. */
const MAX_LENGTH = 512

/** The one segment every mount path contains, whatever the base dir or store namespace. */
const MOUNTS_MARKER = "/mounts/"

/**
 * The sandbox path starting at `from`, or null. Hand-scanned rather than matched with a nested
 * quantifier, which is the polynomial-ReDoS shape CodeQL flags on this kind of input.
 */
export function matchSandboxPath(src: string, from = 0): string | null {
    if (src.charAt(from) !== "/" || src.charAt(from + 1) === "/") return null
    const limit = Math.min(src.length, from + MAX_LENGTH)
    let end = from + 1
    while (end < limit) {
        const char = src.charAt(end)
        if (char !== "/" && !isPathChar(char)) break
        end++
    }
    while (end > from && TRAILING.has(src.charAt(end - 1))) end--
    const path = src.slice(from, end)
    return isSandboxPath(path) ? path : null
}

/**
 * The index where the next bare path begins, for marked's inline scanner. marked calls this once
 * per inline run over the whole remaining source, so the miss case — no mount path in the text at
 * all — has to cost one native substring search, not a walk of every slash in the paragraph.
 */
export function nextPathIndex(src: string): number | undefined {
    if (src.indexOf(MOUNTS_MARKER) === -1) return undefined
    for (let i = src.indexOf("/"); i !== -1; i = src.indexOf("/", i + 1)) {
        const before = i > 0 ? src.charAt(i - 1) : ""
        // A slash mid-word ("and/or") or in a scheme ("https://") never starts a path.
        if (before && (isPathChar(before) || before === ":" || before === "/")) continue
        if (matchSandboxPath(src, i)) return i
    }
    return undefined
}

/** The element the chat markdown renderer maps to its drive-aware file reference. */
export const FILE_PATH_TAG = "agenta-file-path"

export const filePathExtension: TokenizerAndRendererExtension = {
    name: "agentaFilePath",
    level: "inline",
    start: nextPathIndex,
    tokenizer(src) {
        const path = matchSandboxPath(src)
        if (!path) return undefined
        return {type: "agentaFilePath", raw: path, text: path}
    },
    renderer: (token) => `<${FILE_PATH_TAG}>${token.text}</${FILE_PATH_TAG}>`,
}
