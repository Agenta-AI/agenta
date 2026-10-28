import {projectIdAtom, userAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const client = new QueryClient({defaultOptions: {queries: {retry: false}}})

const {organizationApi, vaultApi} = vi.hoisted(() => ({
    organizationApi: {
        createOrganizationSecret: vi.fn(),
        setOrganizationSecretProjects: vi.fn(),
        fetchOrganizationSecrets: vi.fn(),
        fetchOrganizationProjects: vi.fn(),
    },
    vaultApi: {updateVaultSecret: vi.fn()},
}))

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/shared/api")>()),
    getHostQueryClient: () => client,
}))
vi.mock("../../src/secret/api/organizationSecrets", () => organizationApi)
vi.mock("../../src/secret/api/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/secret/api/api")>()),
    ...vaultApi,
}))

import {saveProviderConnectionAtom} from "../../src/secret/state/connections"
import {
    organizationConnectionsAccessAtom,
    organizationSecretsQueryAtom,
} from "../../src/secret/state/organizationConnections"

const PROJECT = "p1"
const SECRETS_KEY = ["vault", "secrets", "u1", PROJECT]
const ORGANIZATION_KEY = ["vault", "organization-secrets", "u1", PROJECT]

const draft = {kind: "openai", name: "Company", credential: {apiKey: "sk-company-0123456789"}}
const limited = {availability: "selected_projects" as const, projectIds: ["p2"]}

const makeStore = () => {
    const store = createStore()
    store.set(queryClientAtom, client)
    store.set(projectIdAtom, PROJECT)
    store.set(userAtom, {id: "u1"} as never)
    return store
}

const invalidated = (key: unknown[]) => client.getQueryState(key)?.isInvalidated ?? false

/** Wait for the organization list to settle, through a live subscription as a page holds. */
const settle = async (store: ReturnType<typeof createStore>) => {
    const stop = store.sub(organizationSecretsQueryAtom, () => undefined)
    await vi.waitFor(() => expect(store.get(organizationSecretsQueryAtom).isFetching).toBe(false), {
        timeout: 5000,
    })
    return stop
}

beforeEach(() => {
    client.clear()
    vi.clearAllMocks()
})

describe("organizationConnectionsAccessAtom", () => {
    it("reads a 403 as the read-only member view", async () => {
        organizationApi.fetchOrganizationSecrets.mockRejectedValue({statusCode: 403})
        const store = makeStore()
        const stop = await settle(store)
        expect(store.get(organizationConnectionsAccessAtom)).toBe("view")
        stop()
    })

    it("drops cached rows once the person is no longer an owner or admin", async () => {
        client.setQueryData(ORGANIZATION_KEY, [{id: "s1"}])
        organizationApi.fetchOrganizationSecrets.mockRejectedValue({statusCode: 403})
        const store = makeStore()
        const stop = await settle(store)
        await client.invalidateQueries({queryKey: ORGANIZATION_KEY})
        await vi.waitFor(() => expect(store.get(organizationConnectionsAccessAtom)).toBe("view"))
        stop()
    })

    it("is manage for an owner or admin's answer and error for any other failure", async () => {
        organizationApi.fetchOrganizationSecrets.mockResolvedValue([])
        const owner = makeStore()
        const stopOwner = await settle(owner)
        expect(owner.get(organizationConnectionsAccessAtom)).toBe("manage")
        stopOwner()

        client.clear()
        organizationApi.fetchOrganizationSecrets.mockRejectedValue({statusCode: 500})
        const broken = makeStore()
        const stopBroken = await settle(broken)
        expect(broken.get(organizationConnectionsAccessAtom)).toBe("error")
        stopBroken()
    })
})

describe("saveProviderConnectionAtom for an organization connection", () => {
    it("creates it with its projects and refreshes both lists", async () => {
        client.setQueryData(SECRETS_KEY, [])
        client.setQueryData(ORGANIZATION_KEY, [])
        organizationApi.createOrganizationSecret.mockResolvedValue({id: "s1"})

        const id = await makeStore().set(saveProviderConnectionAtom, {
            draft,
            fallbackName: "OpenAI",
            organization: {projects: limited, projectsChanged: true},
        })

        expect(id).toBe("s1")
        expect(organizationApi.createOrganizationSecret).toHaveBeenCalledWith(
            expect.objectContaining({projectId: PROJECT, projects: limited}),
        )
        expect(invalidated(SECRETS_KEY) && invalidated(ORGANIZATION_KEY)).toBe(true)
    })

    it("refreshes after a credential write that landed when the projects write fails", async () => {
        client.setQueryData(SECRETS_KEY, [])
        client.setQueryData(ORGANIZATION_KEY, [])
        vaultApi.updateVaultSecret.mockResolvedValue({id: "s1"})
        const refused = {statusCode: 422}
        organizationApi.setOrganizationSecretProjects.mockRejectedValue(refused)

        await expect(
            makeStore().set(saveProviderConnectionAtom, {
                draft,
                fallbackName: "OpenAI",
                connectionId: "s1",
                organization: {projects: limited, projectsChanged: true},
            }),
        ).rejects.toBe(refused)

        expect(vaultApi.updateVaultSecret).toHaveBeenCalledWith(
            expect.objectContaining({secret_id: "s1", scope: "organization"}),
        )
        expect(invalidated(SECRETS_KEY) && invalidated(ORGANIZATION_KEY)).toBe(true)
    })

    it("skips the projects write when the choice did not change", async () => {
        vaultApi.updateVaultSecret.mockResolvedValue({id: "s1"})

        await makeStore().set(saveProviderConnectionAtom, {
            draft,
            fallbackName: "OpenAI",
            connectionId: "s1",
            organization: {projects: limited, projectsChanged: false},
        })

        expect(organizationApi.setOrganizationSecretProjects).not.toHaveBeenCalled()
    })
})
