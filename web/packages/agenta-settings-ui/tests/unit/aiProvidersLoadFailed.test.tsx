// @vitest-environment jsdom
/**
 * AI providers when the project's secrets fail to load: the page must say so, not show an
 * empty Connected list as if the project had no providers.
 */
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

const vault = vi.hoisted(() => ({loading: false, loadFailed: true, mutate: vi.fn()}))

vi.mock("@agenta/entities/secret", async () => {
    const {atom} = await import("jotai")
    return {
        activeModelsSummary: () => "",
        credentialSummary: () => "",
        deleteSecretAtom: atom(null, () => undefined),
        isSubscriptionConnection: () => false,
        SecretManagementPolicy: {ManagerOnly: "manager_only"},
        providerConnectionsAtom: atom([]),
        useVaultSecret: () => vault,
    }
})
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    const capabilities = atom({})
    return {harnessCapabilitiesAtomFamily: () => capabilities}
})
vi.mock("@agenta/entity-ui/secretProvider", () => ({}))
vi.mock("../../src/providers/useOrganizationProvidersGroup", () => ({
    useOrganizationProvidersGroup: () => ({group: null, manageScope: null}),
}))
vi.mock("../../src/providers/ProvidersPanel", () => ({
    ProvidersPanel: ({
        groups,
        loading,
    }: {
        groups: {source: {failure?: React.ReactNode}}[]
        loading: boolean
    }) => (
        <div>
            {loading ? "loading" : null}
            {groups[0].source.failure}
        </div>
    ),
}))

import {AIProvidersPage} from "../../src/providers/AIProvidersPage"

afterEach(cleanup)

describe("AI providers with a failed secrets read", () => {
    it("shows the failure with Try again instead of an empty list", () => {
        render(<AIProvidersPage />)
        expect(screen.getByText("Couldn't load the project connections.")).toBeTruthy()
        screen.getByRole("button", {name: "Try again"}).click()
        expect(vault.mutate).toHaveBeenCalled()
        expect(screen.queryByText("loading")).toBeNull()
    })
})
