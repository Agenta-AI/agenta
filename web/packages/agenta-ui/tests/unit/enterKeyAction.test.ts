/**
 * Unit tests for the composer's Enter rule (#6377).
 *
 * The load-bearing case is the soft keyboard: a phone offers no practical Shift+Enter, so plain
 * Enter must break the line there. Sending on it posted half-written messages every time the user
 * reached for a paragraph break.
 */
import {describe, expect, it} from "vitest"

import {enterKeyAction, type EnterKeyModifiers} from "../../src/RichChatInput/assets/submit"

const keys = (over: Partial<EnterKeyModifiers> = {}): EnterKeyModifiers => ({
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    ...over,
})

describe("enterKeyAction", () => {
    describe("physical keyboard", () => {
        it("sends on plain Enter", () => {
            expect(enterKeyAction(keys(), {softKeyboard: false})).toBe("send")
        })

        it.each(["shiftKey", "metaKey", "ctrlKey"] as const)(
            "breaks the line on %s+Enter",
            (mod) => {
                expect(enterKeyAction(keys({[mod]: true}), {softKeyboard: false})).toBe("newline")
            },
        )

        it("swallows a send that is blocked", () => {
            expect(enterKeyAction(keys(), {softKeyboard: false, disabled: true})).toBe("swallow")
        })
    })

    describe("soft keyboard", () => {
        it("breaks the line on plain Enter instead of sending", () => {
            expect(enterKeyAction(keys(), {softKeyboard: true})).toBe("newline")
        })

        it("still breaks the line while a send is blocked", () => {
            // Nothing is lost by letting the draft grow during a streaming run, and swallowing the
            // key would look like a dead keyboard.
            expect(enterKeyAction(keys(), {softKeyboard: true, disabled: true})).toBe("newline")
        })

        it("breaks the line on a modified Enter from a paired hardware keyboard", () => {
            expect(enterKeyAction(keys({shiftKey: true}), {softKeyboard: true})).toBe("newline")
        })
    })
})
