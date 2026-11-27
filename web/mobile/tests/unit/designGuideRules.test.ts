import rulesJson from "@agenta/ui/design/rules.json"
import {describe, expect, it} from "vitest"

import {guidePages} from "@/features/design-guide/guide/guidePages"
import {termIcons} from "@/features/design-guide/termIcons"

describe("design guide follows rules.json", () => {
    const ids = rulesJson.groups.flatMap((g) => g.rules.map((r) => r.id))
    const shown = guidePages("light").flatMap((p) => p.rules.map((r) => r.id))

    it("shows every rule with a Do and an Avoid example", () => {
        expect(ids.filter((id) => !shown.includes(id))).toEqual([])
    })

    it("shows each rule once, and no rule that rules.json does not have", () => {
        expect(shown.filter((id, i) => shown.indexOf(id) !== i)).toEqual([])
        expect(shown.filter((id) => !ids.includes(id))).toEqual([])
    })

    it("has the icon of every term in the Icon per term table", () => {
        const named = rulesJson.terms.filter((t) => t.icon !== "—").map((t) => t.component)
        expect(named.filter((c) => !termIcons[c])).toEqual([])
    })
})
