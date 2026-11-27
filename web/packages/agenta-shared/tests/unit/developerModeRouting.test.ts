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
    /** The "Use classic app" switch, when the user set it. */
    classicApp?: boolean
}

const cookieFor = ({createdAt, developerMode, classicApp}: UserState) => {
    localStorage.clear()
    localStorage.setItem(ACTIVE_USER_ID_KEY, "u")
    if (developerMode !== undefined) {
        // The stored override is "simplified", the opposite of Developer Mode.
        localStorage.setItem("agenta:onboarding:u:nav-simplified-override", String(!developerMode))
    }
    if (classicApp !== undefined) {
        localStorage.setItem("agenta:settings:u:classic-app", JSON.stringify(classicApp))
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

describe("Developer Mode routing", () => {
    beforeEach(() => {
        localStorage.clear()
    })

    describe("Developer Mode on, classic app off (the default): /w addresses send a desktop browser to /m", () => {
        const rows: [string, UserState][] = [
            ["explicit choice", {createdAt: OLD, developerMode: true}],
            ["on by default (old account)", {createdAt: OLD}],
            [
                "classic app turned off again",
                {createdAt: OLD, developerMode: true, classicApp: false},
            ],
        ]

        for (const [label, state] of rows) {
            it(`${label}: publishes 0`, () => {
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
        }

        it("ignores the old beta developer mode switch", () => {
            for (const beta of ["true", "false"]) {
                localStorage.clear()
                localStorage.setItem(ACTIVE_USER_ID_KEY, "u")
                localStorage.setItem("agenta:onboarding:u:nav-simplified-override", "false")
                localStorage.setItem("agenta:settings:u:beta-developer-mode", beta)
                expect(readSettledClassicModeCookie(profile(OLD))).toBe("0")
            }
        })
    })

    describe("Developer Mode on, classic app on: as before", () => {
        it("on by choice: /m sends the user to /w, phone included", () => {
            const cookie = cookieFor({createdAt: OLD, developerMode: true, classicApp: true})
            expect(cookie).toBe("1")
            expect(gate(decideMobileGate, W_PAGE, DESKTOP_UA, cookie)).toEqual({
                kind: "redirect",
                location: W_PAGE,
            })
            expect(gate(decideDesktopGate, W_PAGE, DESKTOP_UA, cookie)).toEqual(PASS)
            expect(gate(decideDesktopGate, W_PAGE, PHONE_UA, cookie)).toEqual(PASS)
        })

        it("on by default: no cookie, the device decides", () => {
            const cookie = cookieFor({createdAt: OLD, classicApp: true})
            expect(cookie).toBeNull()
            expect(gate(decideDesktopGate, W_PAGE, DESKTOP_UA, cookie)).toEqual(PASS)
            expect(gate(decideDesktopGate, W_PAGE, PHONE_UA, cookie)).toEqual(toM(W_PAGE))
            expect(gate(decideMobileGate, W_PAGE, DESKTOP_UA, cookie)).toEqual(PASS)
        })
    })

    describe("Developer Mode off", () => {
        it("publishes 0 and lives in /m, classic app or not", () => {
            for (const state of [
                {createdAt: OLD, developerMode: false},
                {createdAt: OLD, developerMode: false, classicApp: true},
                {createdAt: NEW},
                {createdAt: NEW, classicApp: true},
            ]) {
                const cookie = cookieFor(state)
                expect(cookie).toBe("0")
                expect(gate(decideDesktopGate, W_PAGE, DESKTOP_UA, cookie)).toEqual(toM(W_PAGE))
                expect(gate(decideMobileGate, W_PAGE, DESKTOP_UA, cookie)).toEqual(PASS)
            }
        })
    })

    it("leaves the cookie alone until the profile lands", () => {
        localStorage.setItem(ACTIVE_USER_ID_KEY, "u")
        expect(readSettledClassicModeCookie(null)).toBeUndefined()
    })
})
