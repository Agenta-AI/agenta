import {activeUserIdAtom, classicModeEnabledAtom} from "@agenta/shared/state"
import {createStore} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

import {migrateSessionPreferences} from "./storage"

beforeEach(() => localStorage.clear())

describe("session preference migration", () => {
    it("moves old desktop preferences to the stable profile uid once", () => {
        localStorage.setItem("agenta:onboarding:session:nav-simplified-override", "false")
        localStorage.setItem("agenta:onboarding:session:widget-events", '["opened"]')
        localStorage.setItem("agenta:settings:session:playground-inspector", "true")
        localStorage.setItem("agenta:observability:has-received-traces:session", "true")
        migrateSessionPreferences("session", "profile")
        expect(localStorage.getItem("agenta:onboarding:profile:nav-simplified-override")).toBe(
            "false",
        )
        expect(localStorage.getItem("agenta:onboarding:profile:widget-events")).toBe('["opened"]')
        expect(localStorage.getItem("agenta:settings:profile:playground-inspector")).toBe("true")
        expect(localStorage.getItem("agenta:observability:has-received-traces:profile")).toBe(
            "true",
        )
        expect(localStorage.getItem("agenta:onboarding:session:nav-simplified-override")).toBeNull()
        localStorage.removeItem("agenta:onboarding:profile:nav-simplified-override")
        migrateSessionPreferences("session", "profile")
        expect(localStorage.getItem("agenta:onboarding:profile:nav-simplified-override")).toBeNull()
    })

    it("updates preferences already mounted under the canonical scope", () => {
        const store = createStore()
        store.set(activeUserIdAtom, "mounted-profile")
        const unsubscribe = store.sub(classicModeEnabledAtom, () => undefined)
        expect(store.get(classicModeEnabledAtom)).toBe(true)
        localStorage.setItem("agenta:onboarding:session:nav-simplified-override", "true")
        migrateSessionPreferences("session", "mounted-profile")
        expect(store.get(classicModeEnabledAtom)).toBe(false)
        unsubscribe()
    })

    it("keeps an existing mobile choice, including false", () => {
        localStorage.setItem("agenta:onboarding:session:nav-simplified-override", "true")
        localStorage.setItem("agenta:onboarding:profile:nav-simplified-override", "false")
        migrateSessionPreferences("session", "profile")
        expect(localStorage.getItem("agenta:onboarding:profile:nav-simplified-override")).toBe(
            "false",
        )
    })

    it("does not migrate a previous account or unrelated data", () => {
        const entries = {
            "agenta:onboarding:other:nav-simplified-override": "true",
            "agenta:onboarding:session-other:nav-simplified-override": "true",
            "agenta:onboarding:active-user-id": "other",
            "other:session:key": "value",
        }
        for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value)
        migrateSessionPreferences("session", "profile")
        for (const [key, value] of Object.entries(entries))
            expect(localStorage.getItem(key)).toBe(value)
        expect(localStorage.length).toBe(Object.keys(entries).length)
    })

    it("is a no-op for identical or missing identities", () => {
        localStorage.setItem("agenta:settings:session:agent-apps", "true")
        migrateSessionPreferences("session", "session")
        migrateSessionPreferences("", "profile")
        migrateSessionPreferences("session", "")
        expect(localStorage.length).toBe(1)
    })

    it("retains the source when storage writes fail", () => {
        const key = "agenta:onboarding:session:nav-simplified-override"
        localStorage.setItem(key, "false")
        const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("Quota exceeded")
        })
        expect(() => migrateSessionPreferences("session", "profile")).not.toThrow()
        write.mockRestore()
        expect(localStorage.getItem(key)).toBe("false")
    })
})
