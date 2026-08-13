/**
 * A marked extension that tokenizes a sandbox file path written as BARE PROSE — "I updated
 * /tmp/agenta/mounts/…/README.md for you" — into a `<agenta-file-path>` element the chat renderer
 * resolves against the session drive (see `markdown.tsx`). Backticked and markdown-linked mentions
 * already had a path there; this closes the third way an agent names a file.
 *
 * Running as a marked extension (rather than a pass over the rendered text) is what makes it safe:
 * marked tokenizes fenced blocks, inline code, and link destinations first, so none of those are
 * rewritten.
 *
 * Scope is deliberately narrow — an absolute path INSIDE the session/agent mounts. A bare relative
 * mention ("see README.md") is indistinguishable from ordinary prose, and an absolute path outside
 * the mounts (`/etc/hosts`) can never resolve to a drive file, so tokenizing either would only buy
 * speculative lookups that always miss.
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

/** Sentence punctuation that trails a path rather than belonging to it ("…/README.md."). */
const TRAILING = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", ">", "'", '"'])

/** Longest plausible mention — a guard against a pathological token, not a real limit. */
const MAX_LENGTH = 512

/**
 * The sandbox path at the START of `src`, or null. Hand-scanned rather than matched with a nested
 * quantifier, which is the polynomial-ReDoS shape CodeQL flags on this kind of input.
 */
export function matchSandboxPath(src: string): string | null {
    if (src.charAt(0) !== "/" || src.charAt(1) === "/") return null
    let end = 1
    while (end < src.length && end < MAX_LENGTH) {
        const char = src.charAt(end)
        if (char !== "/" && !isPathChar(char)) break
        end++
    }
    while (end > 0 && (TRAILING.has(src.charAt(end - 1)) || src.charAt(end - 1) === "/")) end--
    const path = src.slice(0, end)
    return isSandboxPath(path) ? path : null
}

/** May a path start at this index — i.e. is the slash a word boundary and not part of `://`? */
const startsHere = (src: string, index: number): boolean => {
    const before = index > 0 ? src.charAt(index - 1) : ""
    if (before && (isPathChar(before) || before === ":" || before === "/")) return false
    return matchSandboxPath(src.slice(index)) !== null
}

/** The index where the next bare path begins, for marked's inline scanner. */
export function nextPathIndex(src: string): number | undefined {
    for (let i = src.indexOf("/"); i !== -1; i = src.indexOf("/", i + 1)) {
        if (startsHere(src, i)) return i
    }
    return undefined
}

/** The element the chat markdown renderer maps to its drive-aware file reference. */
export const FILE_PATH_TAG = "agenta-file-path"

export const filePathExtension: TokenizerAndRendererExtension = {
    name: "agentaFilePath",
    level: "inline",
    start: (src) => nextPathIndex(src),
    tokenizer(src) {
        const path = matchSandboxPath(src)
        if (!path) return undefined
        return {type: "agentaFilePath", raw: path, text: path}
    },
    renderer: (token) => `<${FILE_PATH_TAG}>${token.text}</${FILE_PATH_TAG}>`,
}
