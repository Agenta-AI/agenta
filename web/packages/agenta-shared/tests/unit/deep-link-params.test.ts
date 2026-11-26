import {describe, expect, it} from "vitest"

import {formatDriveParam, parseDriveParam, withQueryParam} from "../../src/utils/deepLinkParams"

describe("the drive link param", () => {
    it("reads a file, a folder and the root", () => {
        expect(parseDriveParam("reports/q3.pdf")).toEqual({path: "reports/q3.pdf", folder: false})
        expect(parseDriveParam("reports/2026/")).toEqual({path: "reports/2026", folder: true})
        expect(parseDriveParam("/")).toEqual({path: "", folder: true})
        expect(parseDriveParam("")).toEqual({path: "", folder: true})
    })

    it("reads nothing when the param is absent", () => {
        expect(parseDriveParam(null)).toBeNull()
    })

    it("drops a leading slash a hand-typed link may carry", () => {
        expect(parseDriveParam("/notes.md")).toEqual({path: "notes.md", folder: false})
    })

    it("keeps a dotted folder a folder", () => {
        expect(parseDriveParam("v1.2/")).toEqual({path: "v1.2", folder: true})
    })

    it("round-trips what it writes", () => {
        for (const target of [
            {path: "reports/q3.pdf", folder: false},
            {path: "reports", folder: true},
            {path: "", folder: true},
        ]) {
            expect(parseDriveParam(formatDriveParam(target))).toEqual(target)
        }
        expect(formatDriveParam({path: "", folder: true})).toBe("/")
    })
})

describe("withQueryParam", () => {
    const base = "https://app.test/m/w/1/p/2/sessions/s1?agent=a1#turn"

    it("sets the param and keeps the others and the hash", () => {
        expect(withQueryParam(base, "drive", "reports/q3 final.pdf")).toBe(
            "/m/w/1/p/2/sessions/s1?agent=a1&drive=reports/q3+final.pdf#turn",
        )
    })

    it("removes the param when given null", () => {
        expect(
            withQueryParam(`${base.replace("#turn", "")}&automation=x`, "automation", null),
        ).toBe("/m/w/1/p/2/sessions/s1?agent=a1")
    })
})
