import type {ChangeSection} from "@agenta/entities/workflow/commitDiff"
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import {ChangeSections} from "../../src/changes/ChangeSections"

/**
 * Every list-shaped section renders its rows. The renderer once gated rows on `id === "tools"`,
 * so an expanded MCPs or Skills section painted a header over nothing.
 */
const listSection = (id: ChangeSection["id"], title: string, label: string): ChangeSection => ({
    id,
    title,
    tags: [{kind: "added", label: "1 added"}],
    totalCount: 1,
    items: [{id: `${id}-1`, label, kind: "added"}],
})

const markup = (section: ChangeSection) =>
    renderToStaticMarkup(
        <ChangeSections
            sections={[section]}
            openState={{[section.id]: true}}
            onToggleSection={() => undefined}
        />,
    )

describe("ChangeSections", () => {
    it.each([
        ["skills", "Skills", "web-search"],
        ["mcps", "MCPs", "linear"],
        ["tools", "Tools", "send_email"],
        ["subagents", "Subagents", "hourly-news"],
    ] as const)("renders %s rows when the section is open", (id, title, label) => {
        expect(markup(listSection(id, title, label))).toContain(label)
    })

    // The ghost accordion bleeds its band 8px past the pane's content box on BOTH sides, and its
    // rows inset by the same 8px to land back on the content line. Header, rows and the drawer
    // footer then share one left and one right edge; a one-sided bleed is what broke it before.
    it("bleeds the ghost band symmetrically and insets its rows by the same amount", () => {
        const html = renderToStaticMarkup(
            <ChangeSections
                sections={[listSection("tools", "Tools", "send_email")]}
                openState={{tools: true}}
                onToggleSection={() => undefined}
                ghost
            />,
        )
        // Two bleeding boxes: the header band and the body that hangs under it.
        expect(html.match(/-mx-2/g)).toHaveLength(2)
        expect(html).not.toContain("-ml-3.5")
        // Rows pay the bleed back, so their content sits on the pane's content line.
        expect(html).toContain("px-2")
        expect(html).not.toContain("px-3.5")
    })

    it("leaves the card variant on its own inset — nothing bleeds there", () => {
        const html = renderToStaticMarkup(
            <ChangeSections
                sections={[listSection("tools", "Tools", "send_email")]}
                openState={{tools: true}}
                onToggleSection={() => undefined}
            />,
        )
        expect(html).not.toContain("-mx-2")
        expect(html).toContain("px-3.5")
    })

    it("opens a detail view from tool and subagent rows only", () => {
        // Only an EDITED row has anything to drill into.
        const edited = (id: ChangeSection["id"], title: string): ChangeSection => ({
            ...listSection(id, title, "thing"),
            items: [{id: `${id}-1`, label: "thing", kind: "edited"}],
        })
        const buttons = (section: ChangeSection) =>
            renderToStaticMarkup(
                <ChangeSections
                    sections={[section]}
                    openState={{[section.id]: true}}
                    onToggleSection={() => undefined}
                    onOpenTool={() => undefined}
                />,
            ).match(/<button/g)?.length ?? 0

        // The section header is always a button; a drillable row adds a second.
        expect(buttons(edited("tools", "Tools"))).toBe(2)
        expect(buttons(edited("subagents", "Subagents"))).toBe(2)
        expect(buttons(edited("skills", "Skills"))).toBe(1)
        expect(buttons(edited("mcps", "MCPs"))).toBe(1)
    })
})
