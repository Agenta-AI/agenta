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
    assert(match, "Expected a role=\"button\" title group")
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
