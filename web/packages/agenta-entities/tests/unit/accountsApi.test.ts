/**
 * The personal accounts calls go through the generated client: the request each one sends, and
 * the answer it hands back after the zod check.
 */
import {beforeEach, describe, expect, it, vi} from "vitest"

const accountChoices = {
    upsertAccountChoice: vi.fn(),
    queryAccountChoices: vi.fn(),
    resolveAccountChoices: vi.fn(),
    deleteAccountChoice: vi.fn(),
}
const gatewayMcp = {connectMcpEndpoint: vi.fn(), disconnectMcpEndpoint: vi.fn()}
const tools = {
    makeDefaultToolConnection: vi.fn(),
    queryToolConnections: vi.fn(),
    createToolConnection: vi.fn(),
}

vi.mock("@agenta/sdk/resources", () => ({
    getAccountChoicesClient: () => accountChoices,
    getGatewayMcpClient: () => gatewayMcp,
    getToolsClient: () => tools,
    getLowPriorityToolsClient: () => tools,
}))

vi.mock("@agenta/shared/state", async (importOriginal) => {
    const {atom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/shared/state")>()),
        projectIdAtom: atom("project-1"),
    }
})

import {
    deleteAccountChoice,
    queryAccountChoices,
    resolveDraftAccountChoices,
    upsertAccountChoice,
} from "../../src/accountChoice/api"
import {
    createToolConnection,
    makeDefaultToolConnection,
    queryToolConnections,
} from "../../src/gatewayTool/api/api"
import {
    beginPersonalMcpSignIn,
    signInPersonalMcpWithToken,
    signOutPersonalMcp,
} from "../../src/mcpEndpoint/api/api"

const PROJECT = {queryParams: {project_id: "project-1"}}

beforeEach(() => {
    vi.clearAllMocks()
})

describe("account choices", () => {
    it("upserts one choice with exactly one account id", async () => {
        accountChoices.upsertAccountChoice.mockResolvedValue({
            count: 1,
            account_choice: {id: "c-1", workflow_id: "w-1", item_key: "secret:user/KEY"},
        })

        const choice = await upsertAccountChoice({
            projectId: "project-1",
            workflowId: "w-1",
            itemKey: "secret:user/KEY",
            account: {secretId: "s-1"},
        })

        expect(accountChoices.upsertAccountChoice).toHaveBeenCalledWith(
            {account_choice: {workflow_id: "w-1", item_key: "secret:user/KEY", secret_id: "s-1"}},
            PROJECT,
        )
        expect(choice?.id).toBe("c-1")
    })

    it("queries the asker's choices by the secrets they name", async () => {
        accountChoices.queryAccountChoices.mockResolvedValue({count: 0, account_choices: []})

        await queryAccountChoices({projectId: "project-1", filter: {secretIds: ["s-1"]}})

        expect(accountChoices.queryAccountChoices).toHaveBeenCalledWith(
            {account_choice: {workflow_id: undefined, item_key: undefined, secret_ids: ["s-1"]}},
            PROJECT,
        )
    })

    it("resolves a configuration by its parameters and the agent it belongs to", async () => {
        accountChoices.resolveAccountChoices.mockResolvedValue({
            count: 1,
            item_accounts: [{item_key: "secret:user/KEY", match: "choice", is_ready: true}],
        })

        const accounts = await resolveDraftAccountChoices({
            projectId: "project-1",
            workflowId: "w-1",
            parameters: {agent: {}},
        })

        expect(accountChoices.resolveAccountChoices).toHaveBeenCalledWith(
            {workflow_id: "w-1", parameters: {agent: {}}},
            PROJECT,
        )
        expect(accounts).toEqual([
            expect.objectContaining({item_key: "secret:user/KEY", is_ready: true}),
        ])
    })

    it("answers no accounts when the answer does not parse", async () => {
        accountChoices.resolveAccountChoices.mockResolvedValue({item_accounts: "nope"})

        await expect(
            resolveDraftAccountChoices({projectId: "project-1", workflowId: "w-1", parameters: {}}),
        ).resolves.toEqual([])
    })

    it("deletes one choice by id", async () => {
        await deleteAccountChoice({projectId: "project-1", accountChoiceId: "c-1"})

        expect(accountChoices.deleteAccountChoice).toHaveBeenCalledWith(
            {account_choice_id: "c-1"},
            PROJECT,
        )
    })
})

describe("the caller's own MCP sign-in", () => {
    it("starts an OAuth sign-in as the person", async () => {
        gatewayMcp.connectMcpEndpoint.mockResolvedValue({
            count: 1,
            redirect_url: "https://issuer.test/authorize",
            attempt_id: "a-1",
            expires_in: 600,
        })

        const result = await beginPersonalMcpSignIn("e-1", ["read"], "project-1")

        expect(gatewayMcp.connectMcpEndpoint).toHaveBeenCalledWith(
            {endpoint_id: "e-1", owner_kind: "user", scopes: ["read"]},
            PROJECT,
        )
        expect(result).toEqual(expect.objectContaining({attempt_id: "a-1", expires_in: 600}))
    })

    it("sends the person's token", async () => {
        gatewayMcp.connectMcpEndpoint.mockResolvedValue({count: 1})

        await signInPersonalMcpWithToken("e-1", "token-value", "project-1")

        expect(gatewayMcp.connectMcpEndpoint).toHaveBeenCalledWith(
            {endpoint_id: "e-1", owner_kind: "user", token: "token-value"},
            PROJECT,
        )
    })

    it("signs the person out only", async () => {
        await signOutPersonalMcp("e-1", "project-1")

        expect(gatewayMcp.disconnectMcpEndpoint).toHaveBeenCalledWith(
            {endpoint_id: "e-1", owner_kind: "user"},
            PROJECT,
        )
    })
})

describe("the caller's own tool connections", () => {
    it("makes one connection the default", async () => {
        await makeDefaultToolConnection("conn-1")

        expect(tools.makeDefaultToolConnection).toHaveBeenCalledWith(
            {connection_id: "conn-1"},
            PROJECT,
        )
    })

    it("lists the person's connections with scope=user", async () => {
        tools.queryToolConnections.mockResolvedValue({connections: []})

        await queryToolConnections({ownerKind: "user"})

        expect(tools.queryToolConnections).toHaveBeenCalledWith(
            {provider_key: undefined, integration_key: undefined, scope: "user"},
            PROJECT,
        )
    })

    it("lists the project's connections with no scope", async () => {
        tools.queryToolConnections.mockResolvedValue({connections: []})

        await queryToolConnections()

        expect(tools.queryToolConnections).toHaveBeenCalledWith(
            {provider_key: undefined, integration_key: undefined},
            PROJECT,
        )
    })

    it("creates a person's connection with scope=user", async () => {
        tools.createToolConnection.mockResolvedValue({count: 1})
        const payload = {connection: {provider_key: "composio", integration_key: "gmail"}}

        await createToolConnection(payload as never, "user")

        expect(tools.createToolConnection).toHaveBeenCalledWith({...payload, scope: "user"}, PROJECT)
    })
})
