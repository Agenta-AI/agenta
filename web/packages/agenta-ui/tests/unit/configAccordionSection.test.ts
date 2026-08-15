import {createElement} from "react"
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

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

const classesBefore = (markup: string, text: string): string[] => {
    const beforeText = markup.slice(0, markup.indexOf(text))
    const className = beforeText.match(/class="([^"]*)"[^>]*>[^<]*$/)?.[1] ?? ""
    return className.split(" ")
}

describe("ConfigAccordionSection title sizing", () => {
    it("lets the summary shrink before an explicitly preserved title", () => {
        const section = renderSection(true)
        const titleGroup = section.match(/role="button"[^>]*class="([^"]*)"/)?.[1].split(" ")
        const summary = classesBefore(section, "Sandbox: local · Permissions: allow")
        const beforeSummary = section.slice(
            0,
            section.indexOf("Sandbox: local · Permissions: allow"),
        )
        const summaryGroup = beforeSummary.match(/<div class="([^"]*)"><span class="[^"]*">$/)?.[1]

        expect(titleGroup).toContain("shrink-0")
        expect(summary).toEqual(expect.arrayContaining(["min-w-0", "truncate"]))
        expect(summaryGroup?.split(" ")).toContain("min-w-0")
    })

    it("keeps the existing title-first truncation behavior by default", () => {
        const section = renderSection()
        const titleGroup = section.match(/role="button"[^>]*class="([^"]*)"/)?.[1].split(" ")

        expect(titleGroup).not.toContain("shrink-0")
    })
})
