import {beforeEach, describe, expect, it} from "vitest"

// The suite runs on `node`. The cookie reader only needs `localStorage` (see classicMode.test.ts).
const entries: Record<string, string> = {}
const localStorage = {
    getItem: (key: string) => entries[key] ?? null,
    setItem: (key: string, value: string) => {
        entries[key] = value
    },
    removeItem: (key: string) => {
        delete entries[key]
    },
    clear: () => {
        for (const key of Object.keys(entries)) delete entries[key]
    },
}
Object.assign(globalThis, {localStorage, window: {localStorage}})

import {readSettledClassicModeCookie} from "../../src/state/classicMode"
import {ACTIVE_USER_ID_KEY} from "../../src/state/featureFlags"
import {
    CLASSIC_MODE_COOKIE,
    decideDesktopGate,
    decideMobileGate,
    type GateDecision,
    type GateInput,
} from "../../src/utils/mobileGate"

/**
 * Where each kind of user lands, from the stored preferences to the gate decision.
 *
 * Each row stores a user's preferences, takes the cookie value the sync would publish, and runs
 * both gates with it. That is what a reload, a new tab, a bookmark or the Back button does.
 */

const DESKTOP_UA =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
const PHONE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"

const OLD = "2026-07-01 00:00:00.000000+00:00"
const NEW = "2026-08-02 00:00:00.000000+00:00"
const profile = (createdAt: string) => ({
    id: "u",
    uid: "u",
    username: "u",
    email: "u@example.com",
    created_at: createdAt,
})

interface UserState {
    createdAt: string
    /** The Developer Mode switch, when the user set it. `undefined` is the signup-era default. */
    developerMode?: boolean
    beta?: boolean
}

const cookieFor = ({createdAt, developerMode, beta}: UserState) => {
    localStorage.clear()
    localStorage.setItem(ACTIVE_USER_ID_KEY, "u")
    if (developerMode !== undefined) {
        // The stored override is "simplified", the opposite of Developer Mode.
        localStorage.setItem("agenta:onboarding:u:nav-simplified-override", String(!developerMode))
    }
    if (beta !== undefined) {
        localStorage.setItem("agenta:settings:u:beta-developer-mode", JSON.stringify(beta))
    }
    return readSettledClassicModeCookie(profile(createdAt))
}

const gate = (
    decide: (input: GateInput) => GateDecision,
    pathname: string,
    ua: string,
    classic: string | null | undefined,
) =>
    decide({
        pathname,
        search: "",
        method: "GET",
        header: (name) =>
            name === "sec-fetch-dest" ? "document" : name === "user-agent" ? ua : null,
        cookie: (name) => {
            if (name === CLASSIC_MODE_COOKIE) return classic ?? undefined
            if (name === "sAccessToken") return "x"
            return undefined
        },
    })

const PASS = {kind: "pass"}
const toM = (pathname: string) => ({kind: "redirect", location: `/m${pathname}`})

const W_PAGE = "/w/ws/p/p/apps"
const W_UNMAPPED = "/w/ws/p/p/evaluations"
const W_SETTINGS = "/w/ws/p/p/settings"

describe("beta developer mode routing", () => {
    beforeEach(() => localStorage.clear())

    describe("Developer Mode on, beta on: /w addresses send a desktop browser to /m", () => {
        const rows: [string, UserState][] = [
            ["explicit choice", {createdAt: OLD, developerMode: true, beta: true}],
            ["on by default (old account)", {createdAt: OLD, beta: true}],
        ]

        for (const [label, state] of rows) {
            it(`${label}: publishes "0"`, () => {
                expect(cookieFor(state)).toBe("0")
            })

            it(`${label}: desktop /w pages that /m has go to /m`, () => {
                const cookie = cookieFor(state)
                expect(gate(decideDesktopGate, "/w", DESKTOP_UA, cookie)).toMatchObject({
                    kind: "redirect",
                })
                expect(gate(decideDesktopGate, W_PAGE, DESKTOP_UA, cookie)).toEqual(toM(W_PAGE))
                expect(gate(decideDesktopGate, W_SETTINGS, DESKTOP_UA, cookie)).toEqual(
                    toM(W_SETTINGS),
                )
            })

            it(`${label}: /w pages that /m does not have stay in /w`, () => {
                expect(gate(decideDesktopGate, W_UNMAPPED, DESKTOP_UA, cookieFor(state))).toEqual(
                    PASS,
                )
            })

            it(`${label}: /m keeps the user on reload and in a new tab`, () => {
                const cookie = cookieFor(state)
                expect(gate(decideMobileGate, W_PAGE, DESKTOP_UA, cookie)).toEqual(PASS)
                expect(gate(decideMobileGate, W_PAGE, PHONE_UA, cookie)).toEqual(PASS)
            })

            it(`${label}: a phone goes to /m for any /w page, as with no cookie`, () => {
                const cookie = cookieFor(state)
                expect(gate(decideDesktopGate, W_PAGE, PHONE_UA, cookie)).toEqual(toM(W_PAGE))
                for (const page of ["/w", W_UNMAPPED]) {
                    const decision = gate(decideDesktopGate, page, PHONE_UA, cookie)
                    expect(decision.kind).toBe("redirect")
                    expect(decision).toEqual(gate(decideDesktopGate, page, PHONE_UA, null))
                }
            })
        }
    })

    describe("unchanged from v0.128.7", () => {
        it("Developer Mode off: publishes 0 and lives in /m, beta or not", () => {
            for (const state of [
                {createdAt: OLD, developerMode: false},
                {createdAt: OLD, developerMode: false, beta: true},
                {createdAt: NEW},
                {createdAt: NEW, beta: true},
            ]) {
                const cookie = cookieFor(state)
                expect(cookie).toBe("0")
                expect(gate(decideDesktopGate, W_PAGE, DESKTOP_UA, cookie)).toEqual(toM(W_PAGE))
                expect(gate(decideMobileGate, W_PAGE, DESKTOP_UA, cookie)).toEqual(PASS)
            }
        })

        it("Developer Mode on by choice, beta off: /m sends the user to /w, phone included", () => {
            for (const beta of [undefined, false]) {
                const cookie = cookieFor({createdAt: OLD, developerMode: true, beta})
                expect(cookie).toBe("1")
                expect(gate(decideMobileGate, W_PAGE, DESKTOP_UA, cookie)).toEqual({
                    kind: "redirect",
                    location: W_PAGE,
                })
                expect(gate(decideDesktopGate, W_PAGE, DESKTOP_UA, cookie)).toEqual(PASS)
                expect(gate(decideDesktopGate, W_PAGE, PHONE_UA, cookie)).toEqual(PASS)
            }
        })

        it("Developer Mode on by default, beta off: no cookie, the device decides", () => {
            for (const beta of [undefined, false]) {
                const cookie = cookieFor({createdAt: OLD, beta})
                expect(cookie).toBeNull()
                expect(gate(decideDesktopGate, W_PAGE, DESKTOP_UA, cookie)).toEqual(PASS)
                expect(gate(decideDesktopGate, W_PAGE, PHONE_UA, cookie)).toEqual(toM(W_PAGE))
                expect(gate(decideMobileGate, W_PAGE, DESKTOP_UA, cookie)).toEqual(PASS)
            }
        })

        it("turning beta off stores Developer Mode as a choice, so /m sends the user to /w", () => {
            // Both switches store Developer Mode on together with beta off.
            for (const createdAt of [OLD, NEW]) {
                const cookie = cookieFor({createdAt, developerMode: true, beta: false})
                expect(cookie).toBe("1")
                expect(gate(decideMobileGate, W_PAGE, DESKTOP_UA, cookie)).toEqual({
                    kind: "redirect",
                    location: W_PAGE,
                })
            }
        })

        it("leaves the cookie alone until the profile lands", () => {
            localStorage.setItem(ACTIVE_USER_ID_KEY, "u")
            localStorage.setItem("agenta:settings:u:beta-developer-mode", "true")
            expect(readSettledClassicModeCookie(null)).toBeUndefined()
        })
    })
})
