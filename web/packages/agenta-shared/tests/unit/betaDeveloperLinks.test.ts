import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

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

import {readSettledBetaDeveloperModeCookie} from "../../src/state/classicMode"
import {ACTIVE_USER_ID_KEY} from "../../src/state/featureFlags"
import {
    BETA_DEVELOPER_MODE_COOKIE,
    CLASSIC_MODE_COOKIE,
    decideDesktopGate,
    mapMobileToDesktop,
    mobileRouteFor,
    type GateInput,
} from "../../src/utils/mobileGate"
import {SESSION_QUERY_PARAM} from "../../src/utils/sessionParam"

const P = "/w/ws/p/pr"
const M = "/m/w/ws/p/pr"
const BETA = {developerViews: true}

const gate = (pathname: string, cookies: Record<string, string>, search = "") =>
    decideDesktopGate({
        pathname,
        search,
        method: "GET",
        header: (name) =>
            name === "sec-fetch-dest"
                ? "document"
                : name === "user-agent"
                  ? "Mozilla/5.0 (X11; Linux x86_64) Chrome/130"
                  : null,
        cookie: (name) => cookies[name],
    } satisfies GateInput)

describe("mobileRouteFor with developer views", () => {
    const rows: [string, string, string | null][] = [
        [`${P}/apps/a1`, "", `${M}/apps/a1/overview`],
        [`${P}/apps/a1/overview`, "", `${M}/apps/a1/overview`],
        [`${P}/apps/a1/playground`, "?revisions=r1", `${M}/apps/a1/playground`],
        [`${P}/apps/a1/variants`, "", `${M}/variants?app=a1`],
        [`${P}/apps/a1/deployments`, "", `${M}/variants?app=a1`],
        [`${P}/apps/a1/endpoints`, "", `${M}/endpoints?app=a1`],
        [`${P}/apps/a1/traces`, "", `${M}/observability?app=a1`],
        [`${P}/apps/a1/evaluations`, "", `${M}/evaluations?app=a1`],
        [`${P}/apps/a1/evaluations/results/e1`, "", `${M}/evaluations/results/e1`],
        [`${P}/apps/a1/evaluations/results/compare`, "", null],
        [`${P}/apps/a1/sessions`, "", `${M}/agents/a1`],
        [`${P}/prompts`, "", `${M}/prompts`],
        [`${P}/evaluations`, "", `${M}/evaluations`],
        [`${P}/evaluations/results/e1`, "", `${M}/evaluations/results/e1`],
        [`${P}/evaluations/results/compare`, "", null],
        [`${P}/testsets`, "", `${M}/testsets`],
        [`${P}/testsets/t1`, "", `${M}/testsets/t1`],
        [`${P}/testsets/archived`, "", `${M}/testsets/archived`],
        [`${P}/evaluators`, "", `${M}/evaluators`],
        [`${P}/evaluators/archived`, "", `${M}/evaluators/archived`],
        [`${P}/evaluators/playground`, "", null],
        [`${P}/annotations/q1`, "", `${M}/annotations/q1`],
        // Unchanged by the option.
        [`${P}/agents/a1`, "", `${M}/agents/a1`],
        [`${P}/observability`, "", `${M}/observability`],
        [`${P}/apps/agent-templates`, "", `${M}/templates`],
    ]

    it.each(rows)("%s%s", (path, search, expected) => {
        expect(mobileRouteFor(path, search, BETA)).toBe(expected)
    })

    it("keeps an agent session link on the session page", () => {
        expect(mobileRouteFor(`${P}/apps/a1/playground`, `?${SESSION_QUERY_PARAM}=s1`, BETA)).toBe(
            `${M}/sessions/s1?agent=a1`,
        )
    })

    it("without the option every app page still collapses to the agent screen", () => {
        for (const section of ["overview", "playground", "variants", "endpoints", "traces"]) {
            expect(mobileRouteFor(`${P}/apps/a1/${section}`, "")).toBe(`${M}/agents/a1`)
        }
        expect(mobileRouteFor(`${P}/prompts`, "")).toBeNull()
        expect(mobileRouteFor(`${P}/testsets`, "")).toBeNull()
    })
})

describe("mapMobileToDesktop for developer links", () => {
    it.each([
        [`/w/ws/p/pr/prompts`, "", `${P}/prompts`],
        [`/w/ws/p/pr/endpoints`, "?app=a1", `${P}/apps/a1/endpoints`],
        [`/w/ws/p/pr/variants`, "?app=a1", `${P}/apps/a1/variants`],
        [`/w/ws/p/pr/apps/a1/overview`, "", `${P}/apps/a1/overview`],
        [`/w/ws/p/pr/apps/a1/playground`, "", `${P}/apps/a1/playground`],
        [`/w/ws/p/pr/evaluations`, "?app=a1", `${P}/apps/a1/evaluations`],
        [`/w/ws/p/pr/evaluations/results/e1`, "", `${P}/evaluations/results/e1`],
        [`/w/ws/p/pr/testsets/t1`, "", `${P}/testsets/t1`],
        [`/w/ws/p/pr/evaluators`, "", `${P}/evaluators`],
        [`/w/ws/p/pr/apps/archived`, "", `${P}/apps/archived`],
    ])("%s%s", (path, search, expected) => {
        expect(mapMobileToDesktop(path, search)).toBe(expected)
    })

    it("falls back to the desktop root when the page has no desktop twin", () => {
        expect(mapMobileToDesktop("/w/ws/p/pr/endpoints", "")).toBe("/w")
    })
})

describe("the gate and the beta developer mode cookie", () => {
    const classic0 = {[CLASSIC_MODE_COOKIE]: "0", sAccessToken: "x"}
    const links = [
        `${P}/apps/a1/playground`,
        `${P}/apps/a1/overview`,
        `${P}/apps/a1/variants`,
        `${P}/prompts`,
        `${P}/evaluations`,
        `${P}/testsets`,
        `${P}/evaluators`,
    ]

    it("with the cookie, a /w developer link goes to the matching /m page", () => {
        const cookies = {...classic0, [BETA_DEVELOPER_MODE_COOKIE]: "1"}
        expect(gate(`${P}/apps/a1/playground`, cookies)).toEqual({
            kind: "redirect",
            location: `${M}/apps/a1/playground`,
        })
        expect(gate(`${P}/prompts`, cookies)).toEqual({
            kind: "redirect",
            location: `${M}/prompts`,
        })
    })

    it("without the cookie the decision is the v0.128.7 one", () => {
        for (const link of links) {
            const decision = gate(link, classic0)
            const target = mobileRouteFor(link, "")
            expect(decision).toEqual(target ? {kind: "redirect", location: target} : {kind: "pass"})
        }
        expect(gate(`${P}/apps/a1/playground`, classic0)).toEqual({
            kind: "redirect",
            location: `${M}/agents/a1`,
        })
    })

    it("any value but 1 is no cookie", () => {
        for (const value of ["0", "", "true"]) {
            expect(
                gate(`${P}/prompts`, {...classic0, [BETA_DEVELOPER_MODE_COOKIE]: value}),
            ).toEqual({kind: "pass"})
        }
    })
})

describe("readSettledBetaDeveloperModeCookie", () => {
    const user = (createdAt: string) => ({
        id: "u",
        uid: "u",
        username: "u",
        email: "u@example.com",
        created_at: createdAt,
    })
    const OLD = "2026-07-01 00:00:00.000000+00:00"
    const store = ({developerMode, beta}: {developerMode?: boolean; beta?: boolean}) => {
        localStorage.clear()
        localStorage.setItem(ACTIVE_USER_ID_KEY, "u")
        if (developerMode !== undefined) {
            localStorage.setItem(
                "agenta:onboarding:u:nav-simplified-override",
                String(!developerMode),
            )
        }
        if (beta !== undefined) {
            localStorage.setItem("agenta:settings:u:beta-developer-mode", JSON.stringify(beta))
        }
    }

    beforeEach(() => {
        localStorage.clear()
        vi.stubGlobal("__env", {NEXT_PUBLIC_AGENTA_BETA_DEVELOPER_MODE: "true"})
    })
    afterEach(() => vi.unstubAllGlobals())

    it("publishes 1 only when beta, Developer Mode and the env var are all on", () => {
        store({developerMode: true, beta: true})
        expect(readSettledBetaDeveloperModeCookie(user(OLD))).toBe("1")
        // On by default for an old account.
        store({beta: true})
        expect(readSettledBetaDeveloperModeCookie(user(OLD))).toBe("1")
    })

    it("clears it in every other settled state", () => {
        for (const state of [
            {developerMode: true, beta: false},
            {developerMode: true},
            {developerMode: false, beta: true},
        ]) {
            store(state)
            expect(readSettledBetaDeveloperModeCookie(user(OLD))).toBeNull()
        }
        localStorage.clear()
        expect(readSettledBetaDeveloperModeCookie(null)).toBeNull()
    })

    it("clears a stale cookie when the env var is off, whatever the user stored", () => {
        vi.stubGlobal("__env", {NEXT_PUBLIC_AGENTA_BETA_DEVELOPER_MODE: "false"})
        store({developerMode: true, beta: true})
        expect(readSettledBetaDeveloperModeCookie(user(OLD))).toBeNull()
    })

    it("leaves the cookie alone while the profile is unknown", () => {
        store({beta: true})
        expect(readSettledBetaDeveloperModeCookie(null)).toBeUndefined()
    })
})

describe("env var off: a stale beta cookie changes nothing (v0.128.7)", () => {
    // The cookie sync clears it on the next page load; until then the gate may still see it.
    // That is the one window where it can matter, so it is pinned here: the cookie routes as
    // beta, and the only guard is the client clearing it (covered above).
    it("documents that the gate trusts the cookie alone", () => {
        expect(
            gate(`${P}/prompts`, {
                [CLASSIC_MODE_COOKIE]: "0",
                [BETA_DEVELOPER_MODE_COOKIE]: "1",
            }).kind,
        ).toBe("redirect")
    })
})
