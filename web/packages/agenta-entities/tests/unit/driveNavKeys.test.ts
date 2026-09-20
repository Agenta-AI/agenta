import {describe, expect, it} from "vitest"

import {driveNavAction} from "../../src/drive/driveNavKeys"

const ev = (key: string, mods: Partial<Parameters<typeof driveNavAction>[0]> = {}) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    editable: false,
    ...mods,
})

describe("driveNavAction", () => {
    it("maps history to alt+arrows and mod+brackets", () => {
        expect(driveNavAction(ev("ArrowLeft", {altKey: true}))).toBe("back")
        expect(driveNavAction(ev("ArrowRight", {altKey: true}))).toBe("forward")
        expect(driveNavAction(ev("[", {metaKey: true}))).toBe("back")
        expect(driveNavAction(ev("]", {ctrlKey: true}))).toBe("forward")
    })

    it("maps up a level to backspace and mod+up, and Esc to closing the file", () => {
        expect(driveNavAction(ev("Backspace"))).toBe("up")
        expect(driveNavAction(ev("ArrowUp", {metaKey: true}))).toBe("up")
        expect(driveNavAction(ev("Escape"))).toBe("close")
    })

    it("leaves backspace and Esc to a text field, and ignores shifted or plain keys", () => {
        expect(driveNavAction(ev("Backspace", {editable: true}))).toBeNull()
        expect(driveNavAction(ev("Escape", {editable: true}))).toBeNull()
        expect(driveNavAction(ev("ArrowLeft", {altKey: true, shiftKey: true}))).toBeNull()
        expect(driveNavAction(ev("ArrowLeft"))).toBeNull()
        expect(driveNavAction(ev("a"))).toBeNull()
    })
})
