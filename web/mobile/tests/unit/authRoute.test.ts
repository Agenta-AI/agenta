/**
 * The auth gate's routing, and specifically its symmetry.
 *
 * The bug these cover: the gate only routed one way. A transient 401 sent a perfectly valid
 * session to /auth, and because nothing re-checked or routed back, it stayed there.
 */
import {describe, expect, it} from "vitest"

import {authRedirectTarget, shouldCheckSession} from "../../src/features/app/authRoute"

describe("authRedirectTarget", () => {
    it("sends a signed-out session to the sign-in page", () => {
        expect(authRedirectTarget("unauthenticated", "/w/a/p/b/sessions/c")).toBe("/auth")
    })

    it("does not redirect to /auth from /auth (that would loop)", () => {
        expect(authRedirectTarget("unauthenticated", "/auth")).toBeNull()
    })

    it("sends a CONFIRMED session back out of the sign-in page", () => {
        expect(authRedirectTarget("ok", "/auth")).toBe("/")
    })

    it("leaves a confirmed session alone everywhere else", () => {
        expect(authRedirectTarget("ok", "/w/a/p/b/sessions/c")).toBeNull()
    })

    it("moves nobody before a verdict lands", () => {
        expect(authRedirectTarget("unknown", "/auth")).toBeNull()
        expect(authRedirectTarget("unknown", "/w/a/p/b/sessions/c")).toBeNull()
    })

    it("never forwards out of the OIDC callback — that would abort the exchange", () => {
        expect(authRedirectTarget("ok", "/auth/callback")).toBeNull()
        expect(authRedirectTarget("unauthenticated", "/auth/callback")).toBeNull()
    })
})

describe("shouldCheckSession", () => {
    it("keeps asking on /auth, so a wrong verdict can be corrected", () => {
        expect(shouldCheckSession("/auth")).toBe(true)
    })

    it("asks on ordinary screens", () => {
        expect(shouldCheckSession("/w/a/p/b/sessions/c")).toBe(true)
    })

    it("stays quiet during the callback exchange", () => {
        expect(shouldCheckSession("/auth/callback")).toBe(false)
    })
})
