import {describe, expect, it} from "vitest"

import {parseBrowserLiveMessage} from "../../src/browser/live"
import {isCommandKey, toViewportPoint} from "../../src/browser/liveInput"

describe("parseBrowserLiveMessage", () => {
    it("reads a frame with its own viewport size", () => {
        expect(
            parseBrowserLiveMessage(
                JSON.stringify({type: "frame", data: "AAAA", width: 390, height: 844}),
            ),
        ).toEqual({type: "frame", data: "AAAA", width: 390, height: 844})
    })

    it("falls back to the default viewport when a frame has no size", () => {
        expect(parseBrowserLiveMessage(JSON.stringify({type: "frame", data: "AAAA"}))).toEqual({
            type: "frame",
            data: "AAAA",
            width: 1280,
            height: 800,
        })
    })

    it("reads a status and fills missing fields", () => {
        expect(
            parseBrowserLiveMessage(
                JSON.stringify({
                    type: "status",
                    control: "user",
                    url: "https://example.com/",
                    title: "Example",
                    wait_reason: "Log in to the shop",
                }),
            ),
        ).toEqual({
            type: "status",
            control: "user",
            url: "https://example.com/",
            title: "Example",
            waitReason: "Log in to the shop",
            tabs: [],
        })
        expect(parseBrowserLiveMessage(JSON.stringify({type: "status", control: "x"}))).toEqual({
            type: "status",
            control: "agent",
            url: "",
            title: "",
            waitReason: "",
            tabs: [],
        })
    })

    it("reads the tabs of a status and drops a tab with no id", () => {
        const message = parseBrowserLiveMessage(
            JSON.stringify({
                type: "status",
                tabs: [
                    {id: 3, title: "Shop", url: "https://a.test/", active: true},
                    {title: "x"},
                    7,
                ],
            }),
        )
        expect(message).toMatchObject({
            tabs: [{id: 3, title: "Shop", url: "https://a.test/", active: true}],
        })
    })

    it("reads a notice", () => {
        expect(
            parseBrowserLiveMessage(JSON.stringify({type: "notice", message: "Blocked URL"})),
        ).toEqual({type: "notice", message: "Blocked URL"})
    })

    it("drops junk", () => {
        expect(parseBrowserLiveMessage("not json")).toBeNull()
        expect(parseBrowserLiveMessage(JSON.stringify(null))).toBeNull()
        expect(parseBrowserLiveMessage(JSON.stringify({type: "frame"}))).toBeNull()
        expect(parseBrowserLiveMessage(JSON.stringify({type: "notice"}))).toBeNull()
        expect(parseBrowserLiveMessage(JSON.stringify({type: "mystery"}))).toBeNull()
        expect(parseBrowserLiveMessage(new ArrayBuffer(4))).toBeNull()
    })
})

describe("toViewportPoint", () => {
    const canvas = (left: number, top: number, width: number, height: number) => ({
        getBoundingClientRect: () => new DOMRect(left, top, width, height),
    })

    it("maps into the frame's viewport, not the default one", () => {
        expect(
            toViewportPoint(canvas(10, 20, 195, 422), 107.5, 231, {width: 390, height: 844}),
        ).toEqual({x: 195, y: 422})
    })

    it("clamps points outside the canvas to the viewport edges", () => {
        expect(
            toViewportPoint(canvas(0, 0, 100, 100), -50, 500, {width: 390, height: 844}),
        ).toEqual({
            x: 0,
            y: 844,
        })
    })
})

describe("isCommandKey", () => {
    const key = (
        key: string,
        mods: Partial<{ctrlKey: boolean; metaKey: boolean; altKey: boolean}> = {},
    ) => ({
        key,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        ...mods,
    })

    it("leaves composition keys to the text field", () => {
        expect(isCommandKey(key("Dead"))).toBe(false)
        expect(isCommandKey(key("Process"))).toBe(false)
    })

    it("sends named keys as key events", () => {
        expect(isCommandKey(key("Enter"))).toBe(true)
        expect(isCommandKey(key("Backspace"))).toBe(true)
        expect(isCommandKey(key("ArrowLeft"))).toBe(true)
    })

    it("sends printable characters as text", () => {
        expect(isCommandKey(key("a"))).toBe(false)
        expect(isCommandKey(key("A"))).toBe(false)
        expect(isCommandKey(key(" "))).toBe(false)
    })

    it("sends shortcuts with a modifier as key events", () => {
        expect(isCommandKey(key("a", {ctrlKey: true}))).toBe(true)
        expect(isCommandKey(key("c", {metaKey: true}))).toBe(true)
        expect(isCommandKey(key("x", {altKey: true}))).toBe(true)
    })

    it("ignores keys an input method is still composing", () => {
        expect(isCommandKey(key("Unidentified"))).toBe(false)
        expect(isCommandKey(key("Process"))).toBe(false)
    })
})
