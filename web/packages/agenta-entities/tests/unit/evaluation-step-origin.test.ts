import {describe, expect, it} from "vitest"

import {isHumanOrigin, splitByOrigin} from "../../src/evaluationRun"

describe("isHumanOrigin", () => {
    it("is true only for the origin human", () => {
        expect(isHumanOrigin("human")).toBe(true)
        expect(isHumanOrigin("auto")).toBe(false)
        expect(isHumanOrigin("custom")).toBe(false)
        expect(isHumanOrigin(null)).toBe(false)
        expect(isHumanOrigin(undefined)).toBe(false)
    })
})

describe("splitByOrigin", () => {
    it("splits human from the others, each half in input order", () => {
        const items = [
            {id: "a", origin: "auto"},
            {id: "h1", origin: "human"},
            {id: "c", origin: "custom"},
            {id: "n"},
            {id: "h2", origin: "human"},
        ]
        const {human, notHuman} = splitByOrigin(items)
        expect(human.map((item) => item.id)).toEqual(["h1", "h2"])
        expect(notHuman.map((item) => item.id)).toEqual(["a", "c", "n"])
    })

    it("returns two empty halves for no items", () => {
        expect(splitByOrigin([])).toEqual({human: [], notHuman: []})
    })
})
