import type {PersistedQuery} from "@tanstack/query-persist-client-core"
import {describe, expect, it} from "vitest"

import type {NamedSecretRow} from "../../src/secret/core/types"
import {
    VAULT_PERSIST_REDACTED,
    redactPersistedVaultQuery,
    redactVaultSecretRow,
} from "../../src/secret/state/persistence"

const wrap = (data: unknown): PersistedQuery => ({
    state: {
        data,
        dataUpdatedAt: 1234,
        dataUpdateCount: 1,
        error: null,
        errorUpdateCount: 0,
        errorUpdatedAt: 0,
        fetchFailureCount: 0,
        fetchFailureReason: null,
        fetchMeta: null,
        fetchStatus: "idle",
        isInvalidated: false,
        status: "success",
    },
    queryKey: ["vault", "secrets", "user-1", "project-1"],
    queryHash: "hash",
    buster: "v1",
})

describe("redactVaultSecretRow", () => {
    it("redacts a standard provider key but keeps metadata", () => {
        const row = {
            title: "openai",
            key: "sk-live-abc123",
            name: "OPENAI_API_KEY",
            id: "id-1",
            type: "provider_key",
            created_at: "2026-01-01",
        }
        const redacted = redactVaultSecretRow(row)

        expect(redacted.key).toBe(VAULT_PERSIST_REDACTED)
        expect(redacted).toMatchObject({
            title: "openai",
            name: "OPENAI_API_KEY",
            id: "id-1",
            type: "provider_key",
            created_at: "2026-01-01",
        })
        // Input row must not be mutated (it is live query-cache state).
        expect(row.key).toBe("sk-live-abc123")
    })

    it("redacts every custom-provider credential field, keeps config metadata", () => {
        const row = {
            name: "my-bedrock",
            id: "id-2",
            type: "custom_provider",
            provider: "bedrock",
            apiKey: "ak-123",
            apiBaseUrl: "https://bedrock.example.com",
            region: "eu-west-1",
            vertexProject: "proj",
            vertexLocation: "us-central1",
            vertexCredentials: '{"private_key":"----"}',
            accessKeyId: "AKIA123",
            accessKey: "aws-secret",
            sessionToken: "token",
            bearerToken: "bearer",
            models: ["model-a"],
            modelKeys: ["my-bedrock/bedrock/model-a"],
        }
        const redacted = redactVaultSecretRow(row)

        for (const field of [
            "apiKey",
            "accessKeyId",
            "accessKey",
            "sessionToken",
            "bearerToken",
            "vertexCredentials",
        ] as const) {
            expect(redacted[field]).toBe(VAULT_PERSIST_REDACTED)
        }
        expect(redacted.apiBaseUrl).toBe("https://bedrock.example.com")
        expect(redacted.region).toBe("eu-west-1")
        expect(redacted.models).toEqual(["model-a"])
        expect(redacted.modelKeys).toEqual(["my-bedrock/bedrock/model-a"])
    })

    it("leaves empty credential fields empty (presence semantics preserved)", () => {
        const redacted = redactVaultSecretRow({name: "x", apiKey: "", key: undefined})
        expect(redacted.apiKey).toBe("")
        expect(redacted.key).toBeUndefined()
    })

    it("redacts named-secret text content", () => {
        const row: NamedSecretRow = {
            name: "my-token",
            format: "text",
            content: "super-secret-token",
            type: "custom_secret",
        }
        const redacted = redactVaultSecretRow(row) as NamedSecretRow
        expect(redacted.content).toBe(VAULT_PERSIST_REDACTED)
    })

    it("does not throw when content is null", () => {
        const row = {name: "x", format: "json", content: null} as unknown as NamedSecretRow
        expect(() => redactVaultSecretRow(row)).not.toThrow()
        expect((redactVaultSecretRow(row) as NamedSecretRow).content).toBeNull()
    })

    it("redacts named-secret json content values but keeps keys", () => {
        const row: NamedSecretRow = {
            name: "my-env",
            format: "json",
            content: {API_KEY: "abc", REGION: "eu", RETRIES: 3},
            type: "custom_secret",
        }
        const redacted = redactVaultSecretRow(row) as NamedSecretRow
        expect(redacted.content).toEqual({
            API_KEY: VAULT_PERSIST_REDACTED,
            REGION: VAULT_PERSIST_REDACTED,
            RETRIES: VAULT_PERSIST_REDACTED,
        })
        // Original untouched.
        expect(row.content).toEqual({API_KEY: "abc", REGION: "eu", RETRIES: 3})
    })
})

describe("redactPersistedVaultQuery", () => {
    it("redacts state.data rows without mutating the input state", () => {
        const persisted = wrap([{name: "OPENAI_API_KEY", key: "sk-live"}])
        const redacted = redactPersistedVaultQuery(persisted)

        expect((redacted.state.data as {key: string}[])[0].key).toBe(VAULT_PERSIST_REDACTED)
        expect((persisted.state.data as {key: string}[])[0].key).toBe("sk-live")
        expect(redacted.state.dataUpdatedAt).toBe(1234)
        expect(redacted.queryKey).toEqual(persisted.queryKey)
    })

    it("passes empty (null/undefined) data through untouched", () => {
        const persisted = wrap(undefined)
        expect(redactPersistedVaultQuery(persisted)).toBe(persisted)
    })

    it("drops a non-array payload rather than persisting it unredacted (fail-safe)", () => {
        const persisted = wrap({secrets: [{name: "x", key: "sk-live-leak"}]})
        const result = redactPersistedVaultQuery(persisted)
        expect(result.state.data).toBeUndefined()
        expect(JSON.stringify(result)).not.toContain("sk-live-leak")
    })

    it("never leaves a raw secret value anywhere in the serialized payload", () => {
        const persisted = wrap([
            {name: "OPENAI_API_KEY", key: "sk-live-abc"},
            {
                name: "custom",
                type: "custom_provider",
                apiKey: "ck-1",
                accessKey: "aws-2",
                vertexCredentials: "vc-3",
            },
            {name: "blob", type: "custom_secret", format: "json", content: {TOKEN: "tok-4"}},
        ])
        const serialized = JSON.stringify(redactPersistedVaultQuery(persisted))
        for (const secret of ["sk-live-abc", "ck-1", "aws-2", "vc-3", "tok-4"]) {
            expect(serialized).not.toContain(secret)
        }
    })
})
