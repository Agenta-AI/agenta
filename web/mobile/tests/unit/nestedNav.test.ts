import {afterEach, describe, expect, it} from "vitest"

import {isNestedSettingsNavEnabled} from "../../src/features/settings/nestedNav"

const FLAG = "NEXT_PUBLIC_SETTINGS_NESTED_NAV"

afterEach(() => {
    delete process.env[FLAG]
})

describe("isNestedSettingsNavEnabled", () => {
    it("is off unless the flag is explicitly true — the default is the oss takeover", () => {
        expect(isNestedSettingsNavEnabled()).toBe(false)
        process.env[FLAG] = "false"
        expect(isNestedSettingsNavEnabled()).toBe(false)
        process.env[FLAG] = "1"
        expect(isNestedSettingsNavEnabled()).toBe(false)
    })

    it("is on for true in any case", () => {
        process.env[FLAG] = "TRUE"
        expect(isNestedSettingsNavEnabled()).toBe(true)
    })
})
