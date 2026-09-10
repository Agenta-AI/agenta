// @vitest-environment jsdom
import {createStore} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"
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

    it("accepts a payload that an older build wrote once instead of twice", async () => {
        localStorage.setItem(llmAvailableProvidersToken, JSON.stringify([{title: "openai"}]))
        await store.set(migrateVaultKeysAtom)
        expect(store.get(vaultMigrationAtom)).toEqual({migrating: false, migrated: true})
        expect(localStorage.getItem(llmAvailableProvidersToken)).toBeNull()
    })
})
