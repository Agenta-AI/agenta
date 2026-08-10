import {beforeEach, describe, expect, it} from "vitest"

import type {PendingAttachment} from "../../../src/model/attachments"
import {
    attachmentsBySession,
    clearSessionEphemera,
    clearSessionFresh,
    composerDraftBySession,
    freshSessionIds,
    isSessionFresh,
    markSessionFresh,
} from "../../../src/state/sessionEphemera"

const attachment = (uid: string): PendingAttachment => ({
    file: new File(["x"], `${uid}.txt`),
    uid,
    name: `${uid}.txt`,
})

beforeEach(() => {
    composerDraftBySession.clear()
    attachmentsBySession.clear()
    freshSessionIds.clear()
})

describe("composerDraftBySession", () => {
    it("holds one in-progress draft per session", () => {
        composerDraftBySession.set("s1", "hello")
        expect(composerDraftBySession.get("s1")).toBe("hello")
        expect(composerDraftBySession.get("s2")).toBeUndefined()
    })
})

describe("attachmentsBySession", () => {
    it("holds pending attachments typed as PendingAttachment[], not antd UploadFile", () => {
        const pending = [attachment("a1")]
        attachmentsBySession.set("s1", pending)
        expect(attachmentsBySession.get("s1")).toBe(pending)
    })
})

describe("fresh-session marker", () => {
    it("marks, reads, and clears a session's fresh state", () => {
        expect(isSessionFresh("s1")).toBe(false)
        markSessionFresh("s1")
        expect(isSessionFresh("s1")).toBe(true)
        clearSessionFresh("s1")
        expect(isSessionFresh("s1")).toBe(false)
    })
})

describe("clearSessionEphemera", () => {
    it("clears the draft, attachments, and fresh marker for one session", () => {
        composerDraftBySession.set("s1", "draft")
        attachmentsBySession.set("s1", [attachment("a1")])
        markSessionFresh("s1")

        clearSessionEphemera("s1")

        expect(composerDraftBySession.has("s1")).toBe(false)
        expect(attachmentsBySession.has("s1")).toBe(false)
        expect(freshSessionIds.has("s1")).toBe(false)
    })

    it("leaves other sessions' ephemera untouched", () => {
        composerDraftBySession.set("s1", "draft-1")
        composerDraftBySession.set("s2", "draft-2")

        clearSessionEphemera("s1")

        expect(composerDraftBySession.has("s1")).toBe(false)
        expect(composerDraftBySession.get("s2")).toBe("draft-2")
    })
})
