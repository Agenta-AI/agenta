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
