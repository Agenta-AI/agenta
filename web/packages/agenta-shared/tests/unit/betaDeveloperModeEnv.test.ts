import {createStore} from "jotai"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

// Same minimal localStorage stand-in as classicMode.test.ts: this suite runs on `node`.
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

import {
    betaDeveloperModeActiveAtom,
    betaDeveloperModeFlagAtom,
    navSimplifiedOverrideAtom,
    readSettledClassicModeCookie,
} from "../../src/state/classicMode"
import {ACTIVE_USER_ID_KEY, activeUserIdAtom} from "../../src/state/featureFlags"
import type {User} from "../../src/types/user"

const ENV_KEY = "NEXT_PUBLIC_AGENTA_BETA_DEVELOPER_MODE"
const runtime = globalThis as typeof globalThis & {__env?: Record<string, string>}

/** `__env.js` as the entrypoint writes it; `undefined` is an image whose entrypoint omits the key. */
const setRuntimeEnv = (value: string | undefined) => {
    runtime.__env = value === undefined ? {} : {[ENV_KEY]: value}
}

/**
 * `readSettledClassicModeCookie` exactly as it shipped in v0.128.7, before beta developer mode.
 * With the deployment switch off, the cookie decision must be this function, for every user.
 */
const v01287ClassicModeCookie = (user: User | null): "0" | "1" | null | undefined => {
    const readStoredBoolean = (key: string): boolean | null => {
        const raw = localStorage.getItem(key)
        if (raw === null) return null
        try {
            const parsed = JSON.parse(raw)
            return typeof parsed === "boolean" ? parsed : null
        } catch {
            return null
        }
    }
    const isSimplifiedCohort = (u: User | null): boolean => {
        const createdAt = u?.created_at
        if (!createdAt) return false
        const created = Date.parse(createdAt.replace(" ", "T").replace(/\.(\d{3})\d+/, ".$1"))
        return Number.isNaN(created) ? false : created >= Date.parse("2026-08-01T00:00:00Z")
    }

    const userId = localStorage.getItem(ACTIVE_USER_ID_KEY)
    if (!userId) return null
    if (user?.uid && user.uid !== userId) return undefined

    const override = readStoredBoolean(`agenta:onboarding:${userId}:nav-simplified-override`)
    if (override !== null) return override ? "0" : "1"

    if (readStoredBoolean(`agenta:onboarding:${userId}:nav-simplified`) === true) return "0"

    if (!user) return undefined

    return isSimplifiedCohort(user) ? "0" : null
}

const OLD = "2026-07-01 00:00:00.000000+00:00"
const NEW = "2026-08-02 00:00:00.000000+00:00"
const profile = (uid: string, createdAt?: string): User => ({
    id: uid,
    uid,
    username: "u",
    email: "u@example.com",
    ...(createdAt ? {created_at: createdAt} : {}),
})

/** Every combination of what the cookie reader looks at. `undefined` leaves the key unset. */
const STORED_BOOLEANS = [undefined, "true", "false"] as const
const cases = (): {
    name: string
    activeUser: string | null
    override: string | undefined
    signupSeed: string | undefined
    beta: string | undefined
    user: User | null
}[] => {
    const users: [string, User | null][] = [
        ["no profile", null],
        ["old account", profile("u", OLD)],
        ["new account", profile("u", NEW)],
        ["no created_at", profile("u")],
        ["other identity", profile("someone-else", OLD)],
    ]
    const all = []
    for (const activeUser of ["u", null]) {
        for (const override of STORED_BOOLEANS) {
            for (const signupSeed of STORED_BOOLEANS) {
                for (const beta of STORED_BOOLEANS) {
                    for (const [label, user] of users) {
                        all.push({
                            name: `active=${activeUser} override=${override} seed=${signupSeed} beta=${beta} ${label}`,
                            activeUser,
                            override,
                            signupSeed,
                            beta,
                            user,
                        })
                    }
                }
            }
        }
    }
    return all
}

const storeCase = ({
    activeUser,
    override,
    signupSeed,
    beta,
}: {
    activeUser: string | null
    override: string | undefined
    signupSeed: string | undefined
    beta: string | undefined
}) => {
    if (activeUser !== null) localStorage.setItem(ACTIVE_USER_ID_KEY, activeUser)
    if (override !== undefined) {
        localStorage.setItem("agenta:onboarding:u:nav-simplified-override", override)
    }
    if (signupSeed !== undefined) {
        localStorage.setItem("agenta:onboarding:u:nav-simplified", signupSeed)
    }
    if (beta !== undefined) localStorage.setItem("agenta:settings:u:beta-developer-mode", beta)
}

beforeEach(() => {
    localStorage.clear()
})

afterEach(() => {
    delete runtime.__env
})

describe("AGENTA_BETA_DEVELOPER_MODE off: the gate cookie is the v0.128.7 one", () => {
    // Unset, empty, and every value that is not exactly "true".
    for (const env of [undefined, "", "false", "TRUE", "1", "yes"]) {
        it(`env ${JSON.stringify(env)}: matches v0.128.7 for every stored state`, () => {
            setRuntimeEnv(env)
            for (const c of cases()) {
                localStorage.clear()
                storeCase(c)
                expect(readSettledClassicModeCookie(c.user), c.name).toBe(
                    v01287ClassicModeCookie(c.user),
                )
            }
        })
    }

    it("publishes '1' for Developer Mode even when the user stored beta on", () => {
        setRuntimeEnv(undefined)
        storeCase({activeUser: "u", override: "false", signupSeed: undefined, beta: "true"})
        expect(readSettledClassicModeCookie(profile("u", OLD))).toBe("1")
    })
})

describe("AGENTA_BETA_DEVELOPER_MODE on", () => {
    it("lets the stored beta switch change the gate cookie", () => {
        setRuntimeEnv("true")
        storeCase({activeUser: "u", override: "false", signupSeed: undefined, beta: "true"})
        expect(readSettledClassicModeCookie(profile("u", OLD))).not.toBe(
            v01287ClassicModeCookie(profile("u", OLD)),
        )
    })
})

describe("the beta flag atoms", () => {
    let seq = 0
    /** Developer Mode on as a choice, beta stored on, atoms subscribed so storage is read. */
    const signInWithBetaStored = () => {
        const userId = `beta-user-${++seq}`
        localStorage.setItem(`agenta:settings:${userId}:beta-developer-mode`, "true")
        const store = createStore()
        store.set(activeUserIdAtom, userId)
        store.set(navSimplifiedOverrideAtom, false)
        for (const a of [betaDeveloperModeFlagAtom, betaDeveloperModeActiveAtom]) {
            store.sub(a, () => undefined)
        }
        return {store, userId}
    }

    it("read off when the deployment does not offer beta developer mode", () => {
        setRuntimeEnv(undefined)
        const {store} = signInWithBetaStored()
        expect(store.get(betaDeveloperModeFlagAtom)).toBe(false)
        expect(store.get(betaDeveloperModeActiveAtom)).toBe(false)
    })

    it("read the stored switch when the deployment offers it", () => {
        setRuntimeEnv("true")
        const {store} = signInWithBetaStored()
        expect(store.get(betaDeveloperModeFlagAtom)).toBe(true)
        expect(store.get(betaDeveloperModeActiveAtom)).toBe(true)
    })

    it("still write to the user's stored switch", () => {
        setRuntimeEnv("true")
        const {store, userId} = signInWithBetaStored()
        store.set(betaDeveloperModeFlagAtom, false)
        expect(localStorage.getItem(`agenta:settings:${userId}:beta-developer-mode`)).toBe("false")
    })
})
