import {afterEach, describe, expect, it} from "vitest"

import {buildApprovalAnswer, isSteerEnabled} from "../../src/features/chat/steer"

const FLAG = "NEXT_PUBLIC_AGENT_CHAT_STEER"

afterEach(() => {
    delete process.env[FLAG]
})

describe("buildApprovalAnswer", () => {
    it("omits the note entirely for a plain approve/deny", () => {
        expect(buildApprovalAnswer(true)).toEqual({approved: true})
        expect(buildApprovalAnswer(false)).toEqual({approved: false})
    })

    it("trims the redirect note onto a denial", () => {
        expect(buildApprovalAnswer(false, "  write to staging  ")).toEqual({
            approved: false,
            message: "write to staging",
        })
    })

    it("treats a blank note as no note — never an empty trailing user message", () => {
        expect(buildApprovalAnswer(false, "   \n ")).toEqual({approved: false})
    })
})

describe("isSteerEnabled", () => {
    it("is off unless the flag is explicitly true (desktop parity)", () => {
        expect(isSteerEnabled()).toBe(false)
        process.env[FLAG] = "false"
        expect(isSteerEnabled()).toBe(false)
        process.env[FLAG] = "1"
        expect(isSteerEnabled()).toBe(false)
    })

    it("is on for true in any case", () => {
        process.env[FLAG] = "TRUE"
        expect(isSteerEnabled()).toBe(true)
    })
})
