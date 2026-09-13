// @vitest-environment jsdom
import {createStore} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"
import {projectIdAtom} from "@agenta/shared/state"
import {llmAvailableProvidersToken} from "@agenta/shared/utils"

const api = vi.hoisted(() => ({create: vi.fn()}))
vi.mock("../../src/secret/api/api", () => ({
    fetchVaultSecret: vi.fn(async () => []),
    createVaultSecret: api.create,
    updateVaultSecret: vi.fn(),
    deleteVaultSecret: vi.fn(),
}))

import {migrateVaultKeysAtom, vaultMigrationAtom} from "../../src/secret/state/atoms"

let store: ReturnType<typeof createStore>
beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    store = createStore()
    store.set(projectIdAtom, "project-1")
})

describe("legacy vault key migration", () => {
    it("marks the migration done when there is nothing to migrate", async () => {
        await store.set(migrateVaultKeysAtom)
        expect(store.get(vaultMigrationAtom)).toEqual({migrating: false, migrated: true})
    })

    it("does not stay pending when the legacy payload cannot be parsed", async () => {
        localStorage.setItem(llmAvailableProvidersToken, "{not json")
        await store.set(migrateVaultKeysAtom)
        expect(store.get(vaultMigrationAtom)).toEqual({migrating: false, migrated: true})
        expect(localStorage.getItem(llmAvailableProvidersToken)).toBeNull()
        expect(localStorage.getItem(`${llmAvailableProvidersToken}Backup`)).toBe("{not json")
    })

    it("skips null and keyless entries, migrates the rest, and still backs up and clears", async () => {
        localStorage.setItem(
            llmAvailableProvidersToken,
            JSON.stringify(
                JSON.stringify([null, {title: "openai"}, {name: "OPENAI_API_KEY", key: "k"}]),
            ),
        )
        api.create.mockResolvedValue({})
        await store.set(migrateVaultKeysAtom)
        expect(store.get(vaultMigrationAtom)).toEqual({migrating: false, migrated: true})
        expect(api.create).toHaveBeenCalledTimes(1)
        expect(localStorage.getItem(llmAvailableProvidersToken)).toBeNull()
        expect(localStorage.getItem(`${llmAvailableProvidersToken}Backup`)).toContain("openai")
    })

    it("keeps going when one legacy entry fails to save", async () => {
        localStorage.setItem(
            llmAvailableProvidersToken,
            JSON.stringify([
                {name: "OPENAI_API_KEY", key: "k1"},
                {name: "COHERE_API_KEY", key: "k2"},
            ]),
        )
        api.create.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({})
        await store.set(migrateVaultKeysAtom)
        expect(api.create).toHaveBeenCalledTimes(2)
        expect(store.get(vaultMigrationAtom)).toEqual({migrating: false, migrated: true})
        // The entry that failed stays behind for the next page load; the saved one is gone.
        const left = JSON.parse(
            JSON.parse(localStorage.getItem(llmAvailableProvidersToken) ?? '""'),
        )
        expect(left).toEqual([{name: "OPENAI_API_KEY", key: "k1"}])
        expect(localStorage.getItem(`${llmAvailableProvidersToken}Backup`)).toContain("COHERE")
    })

    it("accepts a payload that an older build wrote once instead of twice", async () => {
        localStorage.setItem(llmAvailableProvidersToken, JSON.stringify([{title: "openai"}]))
        await store.set(migrateVaultKeysAtom)
        expect(store.get(vaultMigrationAtom)).toEqual({migrating: false, migrated: true})
        expect(localStorage.getItem(llmAvailableProvidersToken)).toBeNull()
    })
})
