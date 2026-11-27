import {describe, expect, it} from "vitest"

import {arrangePages} from "@/features/nav/pageLayout"

const KEYS = ["home", "agents", "templates", "skills", "prompts", "evaluation"]
const DEV = new Set(["prompts", "evaluation"])

describe("arrangePages", () => {
    it("starts developer pages in More when nothing is saved", () => {
        expect(arrangePages(KEYS, DEV, null)).toEqual({
            visible: ["home", "agents", "templates", "skills"],
            hidden: ["prompts", "evaluation"],
        })
    })

    it("keeps the saved order and the saved hidden pages", () => {
        const saved = {
            visible: ["skills", "home", "prompts"],
            hidden: ["agents", "templates", "evaluation"],
        }
        expect(arrangePages(KEYS, DEV, saved)).toEqual(saved)
    })

    it("drops saved pages that no longer exist", () => {
        const saved = {visible: ["home", "gone", "agents"], hidden: ["old"]}
        expect(arrangePages(["home", "agents"], new Set(), saved)).toEqual({
            visible: ["home", "agents"],
            hidden: [],
        })
    })

    it("places a new page after its default neighbour, or in More when it starts there", () => {
        const saved = {visible: ["agents", "home"], hidden: []}
        expect(arrangePages(["home", "agents", "templates", "prompts"], DEV, saved)).toEqual({
            visible: ["agents", "templates", "home"],
            hidden: ["prompts"],
        })
    })

    it("puts a new first page at the top", () => {
        expect(arrangePages(["new", "home"], new Set(), {visible: ["home"], hidden: []})).toEqual({
            visible: ["new", "home"],
            hidden: [],
        })
    })
})
