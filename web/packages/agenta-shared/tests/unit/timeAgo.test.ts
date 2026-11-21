import {activeLanguageAtom} from "@agenta/i18n"
import {getDefaultStore} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {timeAgo} from "../../src/utils/timeAgo"

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0)
const ago = (seconds: number) => NOW - seconds * 1000

describe("timeAgo", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(NOW)
    })
    afterEach(() => {
        vi.useRealTimers()
        getDefaultStore().set(activeLanguageAtom, "en")
    })

    it("keeps the English words exactly", () => {
        expect(timeAgo(undefined)).toBe("")
        expect(timeAgo(ago(20))).toBe("just now")
        expect(timeAgo(ago(5 * 60))).toBe("5m ago")
        expect(timeAgo(ago(60 * 60))).toBe("1h ago")
        expect(timeAgo(ago(3 * 24 * 3600))).toBe("3d ago")
    })

    it("formats in the active language", () => {
        getDefaultStore().set(activeLanguageAtom, "de-DE")
        expect(timeAgo(ago(20))).toBe("jetzt")
        expect(timeAgo(ago(5 * 60))).toBe("vor 5 Min.")
        expect(timeAgo(ago(3 * 24 * 3600))).toBe("vor 3 Tagen")
    })
})
