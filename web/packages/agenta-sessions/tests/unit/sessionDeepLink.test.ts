import {describe, expect, it} from "vitest"

import {
    isScopePlaygroundPath,
    playgroundSessionPath,
    readSessionParam,
    sessionParamForScope,
    withSessionParam,
} from "../../src/link/sessionDeepLink"

const BASE = "/w/ws-1/p/proj-1/apps"
const APP = "11111111-1111-1111-1111-111111111111"

describe("playgroundSessionPath", () => {
    it("names the session it opens", () => {
        expect(playgroundSessionPath(BASE, APP, "sess-1")).toBe(
            `${BASE}/${APP}/playground?session_id=sess-1`,
        )
    })

    it("falls back to the bare playground with no session", () => {
        expect(playgroundSessionPath(BASE, APP)).toBe(`${BASE}/${APP}/playground`)
    })
})

describe("readSessionParam", () => {
    it("reads the linked session", () => {
        expect(readSessionParam("?session_id=sess-1&revisions=abc")).toBe("sess-1")
    })

    it("ignores the observability drawer's own `session` param", () => {
        expect(readSessionParam("?session=trace-session")).toBe("")
    })
})

describe("isScopePlaygroundPath", () => {
    it("matches the scope's own playground", () => {
        expect(isScopePlaygroundPath(`${BASE}/${APP}/playground`, APP)).toBe(true)
    })

    it("rejects another agent's playground", () => {
        expect(isScopePlaygroundPath(`${BASE}/${APP}/playground`, "other-app")).toBe(false)
    })

    it("rejects surfaces the URL says nothing about", () => {
        expect(isScopePlaygroundPath(`${BASE}/${APP}/playground`, `drawer:${APP}`)).toBe(false)
        expect(isScopePlaygroundPath("/w/ws-1/p/proj-1/playground", "__global__")).toBe(false)
        expect(isScopePlaygroundPath(`${BASE}/${APP}/sessions`, APP)).toBe(false)
    })
})

describe("sessionParamForScope", () => {
    it("hands the scope its own link", () => {
        expect(sessionParamForScope(`${BASE}/${APP}/playground`, "?session_id=sess-1", APP)).toBe(
            "sess-1",
        )
    })

    it("hands nothing to a scope the link isn't for", () => {
        expect(
            sessionParamForScope(`${BASE}/${APP}/playground`, "?session_id=sess-1", "drawer:x"),
        ).toBe("")
    })
})

describe("withSessionParam", () => {
    it("keeps every other param", () => {
        expect(
            withSessionParam("https://app.agenta.ai/p/playground?revisions=abc#pgSnapshot=x", "s2"),
        ).toBe("/p/playground?revisions=abc&session_id=s2#pgSnapshot=x")
    })

    it("replaces an existing link", () => {
        expect(withSessionParam("https://app.agenta.ai/p/playground?session_id=s1", "s2")).toBe(
            "/p/playground?session_id=s2",
        )
    })

    it("drops the param when there is no session", () => {
        expect(withSessionParam("https://app.agenta.ai/p/playground?session_id=s1", null)).toBe(
            "/p/playground",
        )
    })
})
