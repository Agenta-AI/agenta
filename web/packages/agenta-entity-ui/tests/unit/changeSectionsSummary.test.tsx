/**
 * The version history's summary of a text change (S06): only the changed lines, and a removed and
 * added pair drops the start they share, so the box shows what changed.
 */
import type {ExtendedDiffLine} from "@agenta/ui/diff"
import {describe, expect, it} from "vitest"

import {summaryLines} from "../../src/changes/ChangeSections"

const line = (type: ExtendedDiffLine["type"], content: string) =>
    ({type, content}) as ExtendedDiffLine

describe("summaryLines", () => {
    it("drops context lines and the long start a removed and added pair share", () => {
        const start = "Read each ticket, label it, set the urgency"
        expect(
            summaryLines([
                line("context", "# Support triage"),
                line("removed", `${start} and draft a first reply.`),
                line("added", `${start} and draft a first reply in plain words.`),
                line("context", "Billing problems are always high."),
            ]),
        ).toEqual([
            {type: "removed", content: "…and draft a first reply."},
            {type: "added", content: "…and draft a first reply in plain words."},
        ])
    })

    it("keeps a short shared start, and lines that have no single partner", () => {
        expect(
            summaryLines([
                line("removed", "A bug is medium."),
                line("added", "A bug is high."),
                line("added", "Billing is high."),
            ]),
        ).toEqual([
            {type: "removed", content: "A bug is medium."},
            {type: "added", content: "A bug is high."},
            {type: "added", content: "Billing is high."},
        ])
    })
})
