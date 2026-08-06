/**
 * Mustache parser — produces a structural AST from a raw template string.
 *
 * Tracks the full Mustache spec (https://mustache.github.io/mustache.5.html):
 * variables, dotted access, implicit iterator, sections (open + close +
 * inverted), comments, partials (dynamic too), set-delimiter pragmas, blocks
 * (`{{$name}}`) and parent templates (`{{<template}}`).
 *
 * The implementation is a single hand-rolled scanner — no `mustache.js`
 * dependency — because Agenta diverges from spec mustache in two places that
 * a third-party parser wouldn't handle:
 *
 *   - JSONPath: `{{$.geo.region}}` is an Agenta-specific variable form (not
 *     a mustache block). The parser classifies tokens whose body starts with
 *     `$.` or is exactly `$` as variables, NOT blocks. Mustache spec blocks
 *     are still recognised separately when the body starts with `$<name>`
 *     where `<name>` is a bare identifier (no `.`).
 *   - Set-delimiter (`{{=<% %>=}}`) is parsed but the rest of the template
 *     after a delimiter swap continues to use the original `{{ }}` braces.
 *     Agenta has never supported runtime delimiter changes in the FE; this
 *     keeps the parser simple while surfacing the structural tag.
 *
 * Authority for design decisions:
 *   - `docs/designs/mustache-section-support.md` (Phase 2 — section parser)
 *   - Mahmoud's link to the manual (2026-06-02, thread C0B4K2KFUJF)
 */

/** Position info attached to every AST node and parse error. */
export interface SourceSpan {
    /** Character offset where the tag opens (inclusive). */
    start: number
    /** Character offset where the tag closes (exclusive). */
    end: number
}

export type MustacheNode =
    | TextNode
    | VariableNode
    | SectionNode
    | CommentNode
    | PartialNode
    | BlockNode
    | ParentNode
    | DelimiterNode

export interface TextNode extends SourceSpan {
    kind: "text"
    value: string
}

export interface VariableNode extends SourceSpan {
    kind: "variable"
    /** Token text after sigils — e.g. `name`, `geo.region`, `$.geo.region`. */
    name: string
    /** True for `{{&name}}` (and the rejected `{{{name}}}` form). False for `{{name}}`. */
    unescaped: boolean
    /** True when the body is exactly `.` (implicit iterator). `name` is `"."`. */
    implicitIterator: boolean
}

export interface SectionNode extends SourceSpan {
    kind: "section"
    name: string
    /** True for `{{^name}}…{{/name}}` (inverted). False for `{{#name}}…{{/name}}`. */
    inverted: boolean
    children: MustacheNode[]
    /** Span of the closing `{{/name}}` tag. */
    closeSpan: SourceSpan
}

export interface CommentNode extends SourceSpan {
    kind: "comment"
    value: string
}

export interface PartialNode extends SourceSpan {
    kind: "partial"
    name: string
    /** True for `{{>*var}}` — partial name resolved from context at render. */
    dynamic: boolean
}

export interface BlockNode extends SourceSpan {
    kind: "block"
    name: string
    children: MustacheNode[]
    closeSpan: SourceSpan
}

export interface ParentNode extends SourceSpan {
    kind: "parent"
    name: string
    children: MustacheNode[]
    closeSpan: SourceSpan
}

export interface DelimiterNode extends SourceSpan {
    kind: "delimiter"
    open: string
    close: string
}

export type ParseErrorKind =
    | "unbalanced-section"
    | "unexpected-close"
    | "mismatched-close"
    | "malformed-tag"
    | "empty-tag"

export interface ParseError {
    kind: ParseErrorKind
    message: string
    span: SourceSpan
    /** The tag name involved (when applicable). */
    name?: string
}

export interface ParseResult {
    ast: MustacheNode[]
    errors: ParseError[]
}

const OPEN = "{{"
const CLOSE = "}}"

/**
 * Parse a Mustache template into an AST + structural error list.
 *
 * The parser is permissive: it never throws. Errors are collected in
 * `result.errors` so downstream UI can surface them (Phase 2e editor
 * decorations) without preventing the AST from being usable for variable
 * discovery. Unbalanced sections still produce a (degraded) AST.
 */
export function parseMustache(input: string): ParseResult {
    const errors: ParseError[] = []

    /**
     * Frame on the section stack while building the AST. Tracks the section
     * opener so we can emit a SectionNode (or BlockNode / ParentNode) when
     * we encounter its matching close.
     */
    interface Frame {
        kind: "section" | "block" | "parent"
        name: string
        inverted: boolean // only meaningful for kind === "section"
        openSpan: SourceSpan
        children: MustacheNode[]
    }

    const root: MustacheNode[] = []
    const stack: Frame[] = []
    const currentChildren = (): MustacheNode[] => {
        return stack.length > 0 ? stack[stack.length - 1].children : root
    }

    let cursor = 0
    while (cursor < input.length) {
        const openIdx = input.indexOf(OPEN, cursor)
        if (openIdx === -1) {
            // No more tags — remaining string is plain text.
            if (cursor < input.length) {
                currentChildren().push({
                    kind: "text",
                    value: input.slice(cursor),
                    start: cursor,
                    end: input.length,
                })
            }
            break
        }

        // Reject triple-stash `{{{...}}}` form. Mustache spec calls this
        // an unescaped variable, but Agenta has consistently preferred
        // `{{&name}}` (same semantics, no chance of brace-balance
        // confusion). Detect by checking the char AFTER the opener: if
        // it's also `{`, we have `{{{...}}}` — treat as plain text and
        // skip past the matching `}}}`.
        if (input[openIdx + OPEN.length] === "{") {
            // Treat the entire `{{{...}}}` as plain text. Find the closing
            // `}}}` and skip past it. If no triple-close, fall through.
            const tripleClose = input.indexOf("}}}", openIdx + OPEN.length)
            if (tripleClose !== -1) {
                // Plain text up to AND INCLUDING the closing brace of `{{{...}}}`.
                if (cursor < tripleClose + 3) {
                    currentChildren().push({
                        kind: "text",
                        value: input.slice(cursor, tripleClose + 3),
                        start: cursor,
                        end: tripleClose + 3,
                    })
                }
                cursor = tripleClose + 3
                continue
            }
        }

        // Emit text segment between cursor and the opener.
        if (openIdx > cursor) {
            currentChildren().push({
                kind: "text",
                value: input.slice(cursor, openIdx),
                start: cursor,
                end: openIdx,
            })
        }

        const tagStart = openIdx
        const closeIdx = input.indexOf(CLOSE, tagStart + OPEN.length)
        if (closeIdx === -1) {
            // Unclosed `{{` — bail. Remaining text is plain.
            errors.push({
                kind: "malformed-tag",
                message: "Unterminated tag — missing `}}`.",
                span: {start: tagStart, end: input.length},
            })
            currentChildren().push({
                kind: "text",
                value: input.slice(tagStart),
                start: tagStart,
                end: input.length,
            })
            cursor = input.length
            break
        }

        const tagEnd = closeIdx + CLOSE.length
        const rawBody = input.slice(tagStart + OPEN.length, closeIdx)
        const body = rawBody.trim()
        const span: SourceSpan = {start: tagStart, end: tagEnd}

        if (body === "") {
            // `{{}}` or `{{ }}` — empty. Treat as plain text to mirror the
            // editor regex's rejection of empty tags.
            errors.push({
                kind: "empty-tag",
                message: "Empty tag `{{}}` has no name.",
                span,
            })
            currentChildren().push({
                kind: "text",
                value: input.slice(tagStart, tagEnd),
                ...span,
            })
            cursor = tagEnd
            continue
        }

        const sigil = body[0]
        const rest = body.slice(1).trim()

        // Dotted JSONPath form: `{{$.path}}` or just `{{$}}` — Agenta-specific
        // variable syntax, NOT a mustache block. Detect BEFORE the block
        // branch (`$<name>`) so JSONPath wins.
        const isJsonPath = body === "$" || /^\$\./.test(body)

        if (sigil === "#" || sigil === "^") {
            // Section / inverted-section opener.
            stack.push({
                kind: "section",
                name: rest,
                inverted: sigil === "^",
                openSpan: span,
                children: [],
            })
            cursor = tagEnd
            continue
        }

        if (sigil === "/") {
            // Section close. Pop matching frame; report mismatch if names
            // disagree or stack is empty.
            const name = rest
            if (stack.length === 0) {
                errors.push({
                    kind: "unexpected-close",
                    message: `Unexpected closing tag \`{{/${name}}}\` — no open section.`,
                    span,
                    name,
                })
                // Treat as plain text so the AST still represents the source.
                currentChildren().push({
                    kind: "text",
                    value: input.slice(tagStart, tagEnd),
                    ...span,
                })
            } else {
                const top = stack[stack.length - 1]
                if (top.name !== name) {
                    errors.push({
                        kind: "mismatched-close",
                        message: `Closing tag \`{{/${name}}}\` doesn't match open \`{{${top.kind === "block" ? "$" : top.kind === "parent" ? "<" : top.inverted ? "^" : "#"}${top.name}}}\`.`,
                        span,
                        name,
                    })
                    // Still pop — recover by closing the top frame. Common
                    // case: typo in close tag. The (degraded) AST is better
                    // than dropping the frame.
                }
                const popped = stack.pop()!
                const closed: MustacheNode =
                    popped.kind === "block"
                        ? {
                              kind: "block",
                              name: popped.name,
                              children: popped.children,
                              start: popped.openSpan.start,
                              end: span.end,
                              closeSpan: span,
                          }
                        : popped.kind === "parent"
                          ? {
                                kind: "parent",
                                name: popped.name,
                                children: popped.children,
                                start: popped.openSpan.start,
                                end: span.end,
                                closeSpan: span,
                            }
                          : {
                                kind: "section",
                                name: popped.name,
                                inverted: popped.inverted,
                                children: popped.children,
                                start: popped.openSpan.start,
                                end: span.end,
                                closeSpan: span,
                            }
                currentChildren().push(closed)
            }
            cursor = tagEnd
            continue
        }

        if (sigil === "!") {
            currentChildren().push({
                kind: "comment",
                value: rest,
                ...span,
            })
            cursor = tagEnd
            continue
        }

        if (sigil === ">") {
            const dynamic = rest.startsWith("*")
            const name = dynamic ? rest.slice(1).trim() : rest
            currentChildren().push({
                kind: "partial",
                name,
                dynamic,
                ...span,
            })
            cursor = tagEnd
            continue
        }

        if (sigil === "=") {
            // Set-delimiter pragma `{{=<% %>=}}`. The body is `=NEW_OPEN
            // NEW_CLOSE=`. Strip the trailing `=` and split on whitespace.
            // Parser doesn't honour the new delimiters (Agenta never has);
            // we just record the structural tag.
            const inner = rest.endsWith("=") ? rest.slice(0, -1).trim() : rest
            const parts = inner.split(/\s+/)
            const open = parts[0] ?? ""
            const close = parts[1] ?? ""
            currentChildren().push({
                kind: "delimiter",
                open,
                close,
                ...span,
            })
            cursor = tagEnd
            continue
        }

        if (sigil === "$" && !isJsonPath) {
            // Block opener `{{$name}}` (template inheritance). Push frame.
            stack.push({
                kind: "block",
                name: rest,
                inverted: false,
                openSpan: span,
                children: [],
            })
            cursor = tagEnd
            continue
        }

        if (sigil === "<") {
            // Parent template `{{<template}}` (template inheritance). Push.
            stack.push({
                kind: "parent",
                name: rest,
                inverted: false,
                openSpan: span,
                children: [],
            })
            cursor = tagEnd
            continue
        }

        if (sigil === "&") {
            currentChildren().push({
                kind: "variable",
                name: rest,
                unescaped: true,
                implicitIterator: false,
                ...span,
            })
            cursor = tagEnd
            continue
        }

        // Plain variable, dotted path, JSONPath, or implicit iterator.
        currentChildren().push({
            kind: "variable",
            name: body,
            unescaped: false,
            implicitIterator: body === ".",
            ...span,
        })
        cursor = tagEnd
    }

    // Any unclosed sections at EOF are errors. Close them in the AST by
    // attaching their accumulated children to the parent so the rendered
    // tree still reflects the source structure.
    while (stack.length > 0) {
        const popped = stack.pop()!
        errors.push({
            kind: "unbalanced-section",
            message: `Unclosed ${popped.kind === "section" ? (popped.inverted ? "inverted section" : "section") : popped.kind} \`{{${popped.kind === "block" ? "$" : popped.kind === "parent" ? "<" : popped.inverted ? "^" : "#"}${popped.name}}}\` — no matching close tag.`,
            span: popped.openSpan,
            name: popped.name,
        })
        const fallback: MustacheNode =
            popped.kind === "block"
                ? {
                      kind: "block",
                      name: popped.name,
                      children: popped.children,
                      start: popped.openSpan.start,
                      end: input.length,
                      closeSpan: {start: input.length, end: input.length},
                  }
                : popped.kind === "parent"
                  ? {
                        kind: "parent",
                        name: popped.name,
                        children: popped.children,
                        start: popped.openSpan.start,
                        end: input.length,
                        closeSpan: {start: input.length, end: input.length},
                    }
                  : {
                        kind: "section",
                        name: popped.name,
                        inverted: popped.inverted,
                        children: popped.children,
                        start: popped.openSpan.start,
                        end: input.length,
                        closeSpan: {start: input.length, end: input.length},
                    }
        const target = stack.length > 0 ? stack[stack.length - 1].children : root
        target.push(fallback)
    }

    return {ast: root, errors}
}

/**
 * Walk the AST, invoking `visitor` for every node. Sections / blocks /
 * parents recurse into their children. Convenience helper for downstream
 * consumers (variable discovery, validation, etc.).
 *
 * @param onEnter — called before recursing into a node's children
 * @param onExit  — called after a node's children have been walked
 */
export function walkMustache(
    ast: MustacheNode[],
    visitor: {
        onEnter?: (node: MustacheNode, depth: number) => void
        onExit?: (node: MustacheNode, depth: number) => void
    },
    depth = 0,
): void {
    for (const node of ast) {
        visitor.onEnter?.(node, depth)
        if (node.kind === "section" || node.kind === "block" || node.kind === "parent") {
            walkMustache(node.children, visitor, depth + 1)
        }
        visitor.onExit?.(node, depth)
    }
}
