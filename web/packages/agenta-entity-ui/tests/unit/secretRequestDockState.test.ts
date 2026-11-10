import type {AgentSecretBinding, NamedSecretRow} from "@agenta/entities/secret"
import {describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/secret", () => ({
    CustomSecretFormat: {Text: "text", Json: "json"},
    isUserSecretBinding: (binding: AgentSecretBinding) => binding.secret.account_source === "user",
}))

import {
    parseSecretRequest,
    replaceableRow,
    resolveSecretDockSubject,
} from "../../src/clientTools/secretRequestDockState"

const request = {name: "Stripe key", envVar: "STRIPE_KEY", reason: "to bill", rejected: false}
const row = (overrides: Partial<NamedSecretRow> = {}) =>
    ({
        id: "s1",
        name: "Stripe key",
        slug: "stripe-key",
        format: "text",
        ...overrides,
    }) as NamedSecretRow
const projectBinding = {
    secret: {slug: "stripe-key"},
    binding: {type: "env", name: "STRIPE_KEY"},
} as AgentSecretBinding
const userBinding = {
    secret: {account_source: "user"},
    binding: {type: "env", name: "STRIPE_KEY"},
} as AgentSecretBinding

describe("parseSecretRequest", () => {
    it("reads the three required fields and defaults rejected to false", () => {
        expect(parseSecretRequest({name: "A", env_var: "B", reason: "C"})).toEqual({
            name: "A",
            envVar: "B",
            reason: "C",
            rejected: false,
        })
    })

    it("treats only a literal true as rejected", () => {
        const input = {name: "A", env_var: "B", reason: "C"}
        expect(parseSecretRequest({...input, rejected: true})?.rejected).toBe(true)
        expect(parseSecretRequest({...input, rejected: "true"})?.rejected).toBe(false)
    })

    it("refuses a request missing a field", () => {
        expect(parseSecretRequest({name: "A", env_var: "B"})).toBeUndefined()
        expect(parseSecretRequest(undefined)).toBeUndefined()
    })
})

describe("resolveSecretDockSubject", () => {
    const resolve = (
        bindings: AgentSecretBinding[],
        secrets: NamedSecretRow[],
        vault: "checking" | "loaded" | "failed" = "loaded",
    ) => resolveSecretDockSubject({request, bindings, secrets, vault})

    it("waits for the vault read", () => {
        expect(resolve([projectBinding], [row()], "checking")).toEqual({kind: "checking"})
    })

    it("asks for a value when nothing is saved", () => {
        expect(resolve([], [])).toEqual({kind: "empty"})
    })

    it("offers a saved secret that is not attached", () => {
        expect(resolve([], [row()])).toEqual({kind: "saved", row: row()})
    })

    it("does not offer a match with no slug to attach", () => {
        expect(resolve([], [row({slug: undefined})])).toEqual({kind: "empty"})
    })

    it("does not offer a JSON secret as a match", () => {
        expect(resolve([], [row({format: "json" as NamedSecretRow["format"]})])).toEqual({
            kind: "empty",
        })
    })

    it("finds the attachment and its vault record", () => {
        expect(resolve([projectBinding], [row()])).toEqual({
            kind: "attached",
            index: 0,
            binding: projectBinding,
            row: row(),
        })
    })

    it("reports an attachment whose secret was deleted", () => {
        expect(resolve([projectBinding], [])).toEqual({
            kind: "missing",
            index: 0,
            binding: projectBinding,
        })
    })

    it("does not call a secret deleted when the vault could not be read", () => {
        expect(resolve([projectBinding], [], "failed")).toEqual({
            kind: "attached",
            index: 0,
            binding: projectBinding,
        })
    })

    it("matches a saved secret by its default variable or by a differently cased name", () => {
        expect(resolve([], [row({name: "Billing", defaultEnvVar: "STRIPE_KEY"})]).kind).toBe(
            "saved",
        )
        expect(resolve([], [row({name: "  stripe KEY "})]).kind).toBe("saved")
    })

    it("does not read a person's secret as the project secret a binding names", () => {
        expect(resolve([projectBinding], [row({ownerKind: "user"})]).kind).toBe("missing")
    })

    it("keeps a person's own secret attached without a vault record", () => {
        expect(resolve([userBinding], [])).toEqual({
            kind: "attached",
            index: 0,
            binding: userBinding,
        })
    })
})

describe("replaceableRow", () => {
    it("names the text record behind a saved secret", () => {
        expect(replaceableRow({kind: "saved", row: row()})).toEqual(row())
    })

    it("refuses a JSON record, which has no single value", () => {
        const json = row({format: "json" as NamedSecretRow["format"]})
        expect(
            replaceableRow({kind: "attached", index: 0, binding: projectBinding, row: json}),
        ).toBeUndefined()
    })

    it("has nothing to replace for a person's own secret", () => {
        expect(replaceableRow({kind: "attached", index: 0, binding: userBinding})).toBeUndefined()
    })
})
