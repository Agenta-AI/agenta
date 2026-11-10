import {createElement} from "react"

import {renderToStaticMarkup} from "react-dom/server"
import {assert, describe, expect, it} from "vitest"

import {ConfigAccordionSection} from "../../src/components/presentational/section/ConfigAccordionSection"

const renderSection = (preserveTitle = false) =>
    renderToStaticMarkup(
        createElement(ConfigAccordionSection, {
            title: "Advanced",
            summary: "Sandbox: local · Permissions: allow",
            onOpen: () => undefined,
            preserveTitle,
        }),
    )

const textIndex = (markup: string, text: string): number => {
    const index = markup.indexOf(text)
    expect(index).not.toBe(-1)
    return index
}

const classesFromMatch = (markup: string, pattern: RegExp): string[] => {
    const match = markup.match(pattern)
    assert(match, `Expected markup to match ${pattern}`)
    return match[1].split(" ").filter(Boolean)
}

const classesBefore = (markup: string, text: string): string[] =>
    classesFromMatch(markup.slice(0, textIndex(markup, text)), /class="([^"]*)"[^>]*>[^<]*$/)

const titleGroupClasses = (markup: string): string[] => {
    const match = markup.match(/<div[^>]*role="button"[^>]*>/)
    assert(match, 'Expected a role="button" title group')
    return classesFromMatch(match[0], /class="([^"]*)"/)
}

describe("ConfigAccordionSection title sizing", () => {
    it("lets the summary shrink before an explicitly preserved title", () => {
        const section = renderSection(true)
        const titleGroup = titleGroupClasses(section)
        const summaryText = "Sandbox: local · Permissions: allow"
        const summary = classesBefore(section, summaryText)
        const beforeSummary = section.slice(0, textIndex(section, summaryText))
        const summaryGroup = classesFromMatch(
            beforeSummary,
            /<div class="([^"]*)"><span class="[^"]*">$/,
        )

        expect(titleGroup).toContain("shrink-0")
        expect(titleGroup).toContain("max-w-full")
        expect(summary).toEqual(expect.arrayContaining(["min-w-0", "truncate"]))
        expect(summaryGroup).toContain("min-w-0")
    })

    it("keeps the existing title-first truncation behavior by default", () => {
        const section = renderSection()
        const titleGroup = titleGroupClasses(section)

        expect(titleGroup).not.toContain("shrink-0")
    })
})

describe("ConfigAccordionSection header layout", () => {
    const titleGroupMarkup = (markup: string): string => {
        const start = markup.search(/<div[^>]*role="button"/)
        expect(start).not.toBe(-1)
        const summaryStart = markup.indexOf("2 servers")
        return markup.slice(start, summaryStart === -1 ? undefined : summaryStart)
    }

    it("puts the collapse caret right after the title, inside the button group", () => {
        const markup = renderToStaticMarkup(
            createElement(ConfigAccordionSection, {
                title: "MCP servers",
                summary: "2 servers",
                defaultOpen: false,
                extra: createElement("button", {"aria-label": "Add MCP server"}),
            }),
        )
        const group = titleGroupMarkup(markup)
        expect(group).toContain('data-slot="collapse-caret"')
        expect(group.indexOf("MCP servers")).toBeLessThan(group.indexOf("collapse-caret"))
        // The summary comes before `extra`, which ends the row.
        expect(textIndex(markup, "2 servers")).toBeLessThan(textIndex(markup, "Add MCP server"))
    })

    it("gives a drawer row an outline caret after the title, not the collapse caret", () => {
        const markup = renderSection()
        const start = markup.search(/<div[^>]*role="button"/)
        const group = markup.slice(start, textIndex(markup, "Sandbox: local"))
        expect(group).toContain("<svg")
        expect(group).not.toContain("collapse-caret")
    })

    it("keeps the lock on the right and no caret by the title when locked", () => {
        const markup = renderToStaticMarkup(
            createElement(ConfigAccordionSection, {
                title: "MCP servers",
                summary: "2 servers",
                locked: true,
            }),
        )
        // A locked header is not a button, so everything before the summary is the title side.
        expect(markup.slice(0, textIndex(markup, "2 servers"))).not.toContain("<svg")
        expect(markup.slice(textIndex(markup, "2 servers"))).toContain("<svg")
    })
})
