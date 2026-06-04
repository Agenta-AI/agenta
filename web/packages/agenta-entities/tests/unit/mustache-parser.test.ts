/**
 * Unit tests for the Mustache AST parser
 * (`@agenta/shared/utils/mustache#parseMustache`).
 *
 * Coverage spans:
 *   - Every Mustache tag type from the spec (mustache.5).
 *   - Agenta-specific JSONPath handling (`{{$.geo.region}}`) vs spec blocks
 *     (`{{$name}}`).
 *   - Structural error cases: unclosed sections, mismatched closes,
 *     unexpected close-at-root, empty tags, unterminated `{{`.
 *   - Span tracking (start/end offsets) for editor decorations.
 *
 * Authority: `docs/designs/mustache-section-support.md` Phase 2a.
 */
import {describe, expect, it} from "vitest"

import {parseMustache, walkMustache} from "@agenta/shared/utils"
import type {MustacheNode, SectionNode, VariableNode} from "@agenta/shared/utils"

const collect = (ast: MustacheNode[], pred: (n: MustacheNode) => boolean): MustacheNode[] => {
    const out: MustacheNode[] = []
    walkMustache(ast, {
        onEnter: (n) => {
            if (pred(n)) out.push(n)
        },
    })
    return out
}

describe("parseMustache", () => {
    describe("variables", () => {
        it("parses a plain variable", () => {
            const {ast, errors} = parseMustache("Hello {{name}}")
            expect(errors).toEqual([])
            expect(ast).toHaveLength(2)
            expect(ast[0]).toMatchObject({kind: "text", value: "Hello "})
            expect(ast[1]).toMatchObject({kind: "variable", name: "name", unescaped: false})
        })

        it("trims whitespace inside the braces", () => {
            const {ast} = parseMustache("{{  name  }}")
            expect(ast[0]).toMatchObject({kind: "variable", name: "name"})
        })

        it("parses dotted access verbatim", () => {
            const {ast} = parseMustache("{{geo.region}}")
            expect(ast[0]).toMatchObject({kind: "variable", name: "geo.region"})
        })

        it("parses JSONPath as a variable (Agenta-specific)", () => {
            // `{{$.geo.region}}` is NOT a block in Agenta — it's our
            // JSONPath form. Has to be detected BEFORE the block branch.
            const {ast, errors} = parseMustache("{{$.geo.region}}")
            expect(errors).toEqual([])
            expect(ast[0]).toMatchObject({kind: "variable", name: "$.geo.region"})
        })

        it("parses bare `$` as a JSONPath root variable", () => {
            const {ast, errors} = parseMustache("{{$}}")
            expect(errors).toEqual([])
            expect(ast[0]).toMatchObject({kind: "variable", name: "$"})
        })

        it("parses `{{&name}}` as an unescaped variable", () => {
            const {ast} = parseMustache("{{&html}}")
            expect(ast[0]).toMatchObject({kind: "variable", name: "html", unescaped: true})
        })

        it("parses `{{.}}` as the implicit iterator", () => {
            const {ast} = parseMustache("{{.}}")
            const v = ast[0] as VariableNode
            expect(v).toMatchObject({
                kind: "variable",
                name: ".",
                implicitIterator: true,
            })
        })

        it("rejects triple-stash `{{{x}}}` (keeps as plain text)", () => {
            // Mustache spec defines `{{{x}}}` but we recommend `{{&x}}`.
            // The parser treats the triple form as plain text so the
            // tokenizer doesn't slice the braces incorrectly.
            const {ast, errors} = parseMustache("{{{html}}}")
            expect(errors).toEqual([])
            // Should be a single text node containing the whole triple-stash
            expect(ast).toHaveLength(1)
            expect(ast[0]).toMatchObject({kind: "text", value: "{{{html}}}"})
        })

        it("rejects empty tag `{{}}` with an error", () => {
            const {errors} = parseMustache("{{}}")
            expect(errors).toHaveLength(1)
            expect(errors[0]).toMatchObject({kind: "empty-tag"})
        })
    })

    describe("sections", () => {
        it("parses a top-level section with bare children", () => {
            const {ast, errors} = parseMustache("{{#repo}}body{{/repo}}")
            expect(errors).toEqual([])
            expect(ast).toHaveLength(1)
            const section = ast[0] as SectionNode
            expect(section.kind).toBe("section")
            expect(section.name).toBe("repo")
            expect(section.inverted).toBe(false)
            expect(section.children).toHaveLength(1)
            expect(section.children[0]).toMatchObject({kind: "text", value: "body"})
        })

        it("parses inverted section with `^`", () => {
            const {ast, errors} = parseMustache("{{^empty}}fallback{{/empty}}")
            expect(errors).toEqual([])
            const section = ast[0] as SectionNode
            expect(section.inverted).toBe(true)
            expect(section.name).toBe("empty")
        })

        it("parses nested sections", () => {
            const {ast, errors} = parseMustache("{{#org}}{{#users}}{{name}}{{/users}}{{/org}}")
            expect(errors).toEqual([])
            expect(ast).toHaveLength(1)
            const org = ast[0] as SectionNode
            expect(org.name).toBe("org")
            expect(org.children).toHaveLength(1)
            const users = org.children[0] as SectionNode
            expect(users.name).toBe("users")
            const name = users.children[0] as VariableNode
            expect(name).toMatchObject({kind: "variable", name: "name"})
        })

        it("parses variables inside and outside sections in correct order", () => {
            const {ast} = parseMustache("{{a}}{{#sec}}{{b}}{{/sec}}{{c}}")
            expect(ast).toHaveLength(3)
            expect((ast[0] as VariableNode).name).toBe("a")
            expect((ast[1] as SectionNode).name).toBe("sec")
            expect((ast[1] as SectionNode).children[0]).toMatchObject({
                kind: "variable",
                name: "b",
            })
            expect((ast[2] as VariableNode).name).toBe("c")
        })

        it("records closing span on section nodes", () => {
            const {ast} = parseMustache("{{#x}}abc{{/x}}")
            const section = ast[0] as SectionNode
            // `{{#x}}` is 6 chars, `abc` is 3, `{{/x}}` starts at 9.
            expect(section.closeSpan.start).toBe(9)
            expect(section.closeSpan.end).toBe(15)
        })
    })

    describe("comments and partials", () => {
        it("parses comments", () => {
            const {ast} = parseMustache("hello {{! a note }} world")
            expect(ast).toHaveLength(3)
            expect(ast[1]).toMatchObject({kind: "comment", value: "a note"})
        })

        it("parses a partial", () => {
            const {ast} = parseMustache("{{> user_card}}")
            expect(ast[0]).toMatchObject({kind: "partial", name: "user_card", dynamic: false})
        })

        it("parses a dynamic partial `{{>*name}}`", () => {
            const {ast} = parseMustache("{{>*template}}")
            expect(ast[0]).toMatchObject({kind: "partial", name: "template", dynamic: true})
        })
    })

    describe("set-delimiter pragma", () => {
        it("parses `{{=<% %>=}}`", () => {
            const {ast} = parseMustache("{{=<% %>=}}")
            expect(ast[0]).toMatchObject({kind: "delimiter", open: "<%", close: "%>"})
        })
    })

    describe("blocks and parent templates (inheritance)", () => {
        it("parses a block `{{$name}}...{{/name}}`", () => {
            const {ast, errors} = parseMustache("{{$slot}}body{{/slot}}")
            expect(errors).toEqual([])
            expect(ast[0]).toMatchObject({kind: "block", name: "slot"})
            expect((ast[0] as any).children[0]).toMatchObject({kind: "text", value: "body"})
        })

        it("distinguishes `{{$name}}` (block) from `{{$.name}}` (JSONPath)", () => {
            const {ast: blockAst} = parseMustache("{{$slot}}{{/slot}}")
            expect(blockAst[0].kind).toBe("block")

            const {ast: pathAst} = parseMustache("{{$.foo}}")
            expect(pathAst[0]).toMatchObject({kind: "variable", name: "$.foo"})
        })

        it("parses a parent template `{{<template}}...{{/template}}`", () => {
            const {ast, errors} = parseMustache("{{<base}}body{{/base}}")
            expect(errors).toEqual([])
            expect(ast[0]).toMatchObject({kind: "parent", name: "base"})
        })
    })

    describe("error recovery", () => {
        it("reports an error for unclosed sections but still returns AST", () => {
            const {ast, errors} = parseMustache("{{#never_closes}}body")
            expect(errors).toHaveLength(1)
            expect(errors[0].kind).toBe("unbalanced-section")
            // AST still has the section (with body as child) — closeSpan
            // collapses to end-of-input.
            expect(ast[0].kind).toBe("section")
            const section = ast[0] as SectionNode
            expect(section.children[0]).toMatchObject({kind: "text", value: "body"})
        })

        it("reports an error for mismatched close tag", () => {
            const {ast, errors} = parseMustache("{{#a}}{{/b}}")
            expect(errors).toHaveLength(1)
            expect(errors[0].kind).toBe("mismatched-close")
            // Recovery: close the `a` frame anyway. AST has a section
            // node named `a`.
            const sections = collect(ast, (n) => n.kind === "section")
            expect(sections).toHaveLength(1)
            expect((sections[0] as SectionNode).name).toBe("a")
        })

        it("reports an error for an unexpected close at root", () => {
            const {errors} = parseMustache("text{{/orphan}}more")
            expect(errors).toHaveLength(1)
            expect(errors[0].kind).toBe("unexpected-close")
        })

        it("reports an error for an unterminated `{{`", () => {
            const {ast, errors} = parseMustache("hello {{name")
            expect(errors).toHaveLength(1)
            expect(errors[0].kind).toBe("malformed-tag")
            // Remaining unterminated bit collected as text node
            expect(ast.some((n) => n.kind === "text" && n.value.includes("{{name"))).toBe(true)
        })
    })

    describe("source spans", () => {
        it("attaches accurate start/end offsets to variable nodes", () => {
            const {ast} = parseMustache("abc {{name}} xyz")
            const v = ast[1] as VariableNode
            expect(v.start).toBe(4)
            expect(v.end).toBe(12)
        })

        it("section span covers the entire `{{#a}}...{{/a}}` extent", () => {
            const {ast} = parseMustache("{{#a}}body{{/a}}")
            const section = ast[0] as SectionNode
            expect(section.start).toBe(0)
            expect(section.end).toBe(16)
        })
    })
})

describe("walkMustache", () => {
    it("visits every node in order with correct depths", () => {
        const {ast} = parseMustache("{{a}}{{#sec}}{{b}}{{/sec}}")
        const visits: {kind: string; depth: number; name?: string}[] = []
        walkMustache(ast, {
            onEnter: (node, depth) => {
                visits.push({
                    kind: node.kind,
                    depth,
                    name:
                        node.kind === "variable" ||
                        node.kind === "section" ||
                        node.kind === "block" ||
                        node.kind === "parent"
                            ? node.name
                            : undefined,
                })
            },
        })
        expect(visits).toEqual([
            {kind: "variable", depth: 0, name: "a"},
            {kind: "section", depth: 0, name: "sec"},
            {kind: "variable", depth: 1, name: "b"},
        ])
    })

    it("fires onExit after children", () => {
        const {ast} = parseMustache("{{#sec}}body{{/sec}}")
        const events: {phase: "enter" | "exit"; kind: string}[] = []
        walkMustache(ast, {
            onEnter: (n) => events.push({phase: "enter", kind: n.kind}),
            onExit: (n) => events.push({phase: "exit", kind: n.kind}),
        })
        expect(events).toEqual([
            {phase: "enter", kind: "section"},
            {phase: "enter", kind: "text"},
            {phase: "exit", kind: "text"},
            {phase: "exit", kind: "section"},
        ])
    })
})
