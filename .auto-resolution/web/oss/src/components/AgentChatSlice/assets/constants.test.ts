import {afterEach, describe, expect, it, vi} from "vitest"

import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

import {isAgentVoiceInputAvailable} from "./constants"

vi.mock("@/oss/lib/helpers/dynamicEnv", () => ({getEnv: vi.fn(() => "")}))

const mockedGetEnv = vi.mocked(getEnv)

describe("voice input gating", () => {
    afterEach(() => {
        mockedGetEnv.mockReset()
        mockedGetEnv.mockReturnValue("")
    })

    it("stays off when neither the setting nor the env flag is on", () => {
        expect(isAgentVoiceInputAvailable(false)).toBe(false)
    })

    it("turns on from the per-user setting alone", () => {
        expect(isAgentVoiceInputAvailable(true)).toBe(true)
    })

    it("turns on from the env flag alone, so dev stacks keep working", () => {
        mockedGetEnv.mockReturnValue("true")
        expect(isAgentVoiceInputAvailable(false)).toBe(true)
    })
})
