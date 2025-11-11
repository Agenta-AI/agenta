import {load as yamlLoad, dump as yamlDump, type DumpOptions} from "js-yaml"
import JSON5 from "json5"
import {$getRoot, LexicalEditor} from "lexical"
import {$isCodeBlockNode} from "../../Editor/plugins/code/nodes/CodeBlockNode"
import {$isCodeNode} from "@lexical/code"
import {
    $convertToMarkdownStringCustom,
    PLAYGROUND_TRANSFORMERS,
} from "../../Editor/plugins/markdown/assets/transformers"
import {Format} from "../SimpleSharedEditor/types"

/** Strip one pair of matching outer quotes if present */
function stripOuterQuotes(s: string): string {
    if (s.length >= 2) {
        const q = s[0]
        if ((q === '"' || q === "'") && s[s.length - 1] === q) return s.slice(1, -1)
    }
    return s
}

/** Convert literal escapes like "\n" into real newlines if needed */
function unescapeCommonEscapes(s: string): string {
    // Only unescape if there are no real newlines but there ARE literal \n (common LLM output)
    if (!/[\r\n]/.test(s) && /\\n/.test(s)) {
        s = s.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n")
    }
    // Optional: tabs and quotes
    s = s.replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\'/g, "'")
    return s
}

/** Unwrap a single fenced code block (```lang ... ``` or ~~~lang ... ~~~) */
function unwrapFence(s: string): {lang?: string; text: string} | null {
    const t = s.trim()
    const re = /^(?:```|~~~)\s*([A-Za-z0-9+_.-]*)\s*\r?\n([\s\S]*?)\r?\n(?:```|~~~)\s*$/
    const m = t.match(re)
    if (!m) return null
    return {lang: m[1]?.toLowerCase() || undefined, text: m[2]}
}

/** Optional: support YAML front-matter style --- ... --- */
function unwrapFrontMatter(s: string): string | null {
    const m = s.match(/^\s*---\s*\r?\n([\s\S]*?)\r?\n---\s*$/)
    return m ? m[1] : null
}

export function checkIsJSON(input: any): boolean {
    if (!input || input === "{}" || input === "[]") return false
    if (typeof input !== "string") return false
    try {
        const parsed = JSON5.parse(input)
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    } catch {
        return false
    }
}

export function checkIsYAML(input: any): boolean {
    if (!input || typeof input !== "string") return false

    // 1) Normalize
    let s = stripOuterQuotes(input).trim()
    s = unescapeCommonEscapes(s)

    // 2) If it cleanly parses as JSON object, treat as JSON (YAML is a superset)
    try {
        const asJson = JSON5.parse(s)
        if (asJson && typeof asJson === "object") return false
    } catch {
        // not JSON → continue
    }

    // 3) Unwrap fence or front-matter if present
    const fenced = unwrapFence(s)
    if (fenced) {
        if (fenced.lang === "json") return false // explicitly JSON
        s = fenced.text
    } else {
        const fm = unwrapFrontMatter(s)
        if (fm) s = fm
    }

    // 4) Guard for raw JSON-looking start
    const c0 = s.trim()[0]
    if (c0 === "{" || c0 === "[") return false

    // 5) Try YAML parse
    try {
        const parsed = yamlLoad(s)

        // Only count YAML *mappings* (plain objects) as "YAML"
        const isPlainObject =
            parsed !== null &&
            typeof parsed === "object" &&
            !Array.isArray(parsed) &&
            Object.prototype.toString.call(parsed) === "[object Object]"

        return isPlainObject && Object.keys(parsed).length > 0 // require at least one key
    } catch {
        return false
    }
}

/** Minimal check: does the string look like real HTML (not JSON/YAML/markdown)? */
export function checkIsHTML(input: any): boolean {
    if (typeof input !== "string") return false

    const s = input.trim()
    if (!s || s.startsWith("{") || s.startsWith("[") || s.startsWith("---")) return false // quick guards
    if (s.startsWith("```") || s.startsWith("~~~")) return false // fenced code blocks

    // Must contain angle brackets at all
    if (s.indexOf("<") === -1 || s.indexOf(">") === -1) return false

    // Matches: <tag ...>...</tag>  OR  self-closing/void tags like <br>, <img />, <input>
    const HTML_RE =
        /<([a-z][a-z0-9-]*)\b[^>]*>([\s\S]*?)<\/\1\s*>|<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr|li|div|body)\b[^>]*\/?>/i

    return HTML_RE.test(s)
}

/**
 * Parse a YAML-ish string (handles LLM-escaped newlines and fences) and
 * return a formatted YAML string. If parsing fails, it throws.
 */
export function formatYAML(input: string, opts?: DumpOptions): string {
    if (typeof input !== "string") return input

    // 1) normalize
    let s = stripOuterQuotes(input).trim()
    s = unescapeCommonEscapes(s)

    // 2) unwrap fences/front-matter if present
    const fenced = unwrapFence(s)
    if (fenced) s = fenced.text
    else {
        const fm = unwrapFrontMatter(s)
        if (fm) s = fm
    }

    // 3) parse as YAML (will also parse JSON since YAML is a superset)
    const value = yamlLoad(s)

    // 4) dump back to nicely formatted YAML
    return yamlDump(value, {
        lineWidth: -1, // no hard wrapping
        noRefs: true, // inline duplicates instead of anchors
        ...(opts || {}),
    })
}

export function getDisplayedContent(editor: LexicalEditor, language: Format): string {
    return editor.getEditorState().read(() => {
        const root = $getRoot()

        // JSON/YAML modes use a top-level CodeBlockNode
        if (language === "json" || language === "yaml") {
            const codeBlock = root.getChildren().find($isCodeBlockNode)
            const text = codeBlock ? codeBlock.getTextContent() : ""

            if (language === "yaml") {
                try {
                    return formatYAML(text)
                } catch {
                    return text
                }
            }

            try {
                // round-trip to stable JSON string
                const obj = JSON.parse(text)
                return JSON.stringify(obj, null, 2)
            } catch {
                return text
            }
        }

        // Markdown view: if the document is represented by a top-level Markdown CodeNode,
        // return its raw text content (no ```markdown fences). Otherwise, fall back to
        // converting the rich document to markdown.
        if (language === "markdown") {
            const markdownCodeNode = root
                .getChildren()
                .find((n) => $isCodeNode(n) && n.getLanguage && n.getLanguage() === "markdown")

            if (markdownCodeNode) {
                return markdownCodeNode.getTextContent()
            }

            return $convertToMarkdownStringCustom(PLAYGROUND_TRANSFORMERS, undefined, true)
        }

        // Plain text: rich text content as text
        return root.getTextContent()
    })
}
