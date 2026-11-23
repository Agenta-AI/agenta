import {describe, expect, it} from "vitest"

import rulesJson from "@/design/rules.json"
import {guidePages} from "@/features/design-system/guide/guidePages"

describe("design guide follows DESIGN.md", () => {
    const ids = rulesJson.groups.flatMap((g) => g.rules.map((r) => r.id))
    const shown = guidePages("light").flatMap((p) => p.rules.map((r) => r.id))

    it("shows every DESIGN.md rule with a Do and an Avoid example", () => {
        expect(ids.filter((id) => !shown.includes(id))).toEqual([])
    })

    it("shows each rule once, and no rule that DESIGN.md does not have", () => {
        expect(shown.filter((id, i) => shown.indexOf(id) !== i)).toEqual([])
        expect(shown.filter((id) => !ids.includes(id))).toEqual([])
    })
})
