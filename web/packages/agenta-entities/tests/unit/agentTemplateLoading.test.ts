import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {createWorkflowMock, loadAgentTemplateMock, fetchOverlayMock, queryConnectionsMock} =
    vi.hoisted(() => ({
        createWorkflowMock: vi.fn(),
        loadAgentTemplateMock: vi.fn(),
        fetchOverlayMock: vi.fn(),
        queryConnectionsMock: vi.fn(),
    }))

vi.mock("../../src/workflow/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/workflow/api")>()
    return {
        ...actual,
        createWorkflow: createWorkflowMock,
        fetchAgentBuildKitOverlay: fetchOverlayMock,
    }
})

vi.mock("../../src/workflow/api/agentTemplates", () => ({
    loadAgentTemplate: loadAgentTemplateMock,
}))

vi.mock("../../src/gatewayTool/api", () => ({
    queryToolConnections: queryConnectionsMock,
}))

import {templateBuilderMessage} from "../../src/workflow/agentTemplates"
import type {AgentTemplateLoadResult} from "../../src/workflow/api/agentTemplates"
import {createWorkflowFromEphemeralAtom} from "../../src/workflow/state/commit"
import {buildCreatePayloadFromEphemeral} from "../../src/workflow/state/createPayload"
import {
    loadAgentTemplateFromEphemeralAtom,
    templateConnectionChoices,
} from "../../src/workflow/state/loadTemplate"
import {workflowLocalServerDataAtomFamily} from "../../src/workflow/state/store"

import {FIXTURE_TEMPLATES as AGENT_TEMPLATES} from "./agentTemplateFixtures"

const REVISION_ID = "local-template-loading"
const WORKFLOW_DATA = {
    uri: "agenta:builtin:agent:v0",
    parameters: {
        agent: {
            instructions: {agents_md: "Review pull requests."},
            tools: [{type: "builtin", name: "read"}],
        },
    },
    schemas: {
        parameters: {type: "object"},
        inputs: {type: "object", properties: {messages: {type: "array"}}},
        outputs: {type: "object"},
    },
}

const store = getDefaultStore()

beforeEach(() => {
    fetchOverlayMock.mockReset().mockResolvedValue({
        tools: [{type: "platform", op: "create_schedule", permission: "allow"}],
        op_access: {create_schedule: "write"},
    })
    createWorkflowMock.mockReset()
    createWorkflowMock.mockResolvedValue({
        id: "ordinary-revision",
        workflow_id: "ordinary-workflow",
        workflow_variant_id: "ordinary-variant",
        data: WORKFLOW_DATA,
    })
    queryConnectionsMock.mockReset().mockResolvedValue({count: 0, connections: []})
    loadAgentTemplateMock.mockReset()
    loadAgentTemplateMock.mockResolvedValue({
        workflow_id: "loaded-workflow",
        workflow_slug: "pr-reviewer",
        variant_id: "loaded-variant",
        revision_id: "loaded-revision",
        session_id: "loaded-session",
        execution_id: "loaded-execution",
        input_id: "loaded-input",
        replayed: false,
    })
    store.set(projectIdAtom, "project-1")
    store.set(queryClientAtom, new QueryClient())
    store.set(workflowLocalServerDataAtomFamily(REVISION_ID), {
        id: REVISION_ID,
        name: "Pull request reviewer",
        flags: {is_application: true, is_agent: true},
        data: WORKFLOW_DATA,
        meta: {__ephemeral: true},
    } as never)
})

describe("shared ephemeral creation payload", () => {
    it("gives ordinary creation and template loading identical revision data and role flags", async () => {
        const expected = buildCreatePayloadFromEphemeral(store.get, REVISION_ID)

        const result = await store.set(createWorkflowFromEphemeralAtom, {
            revisionId: REVISION_ID,
            name: "Pull request reviewer",
            slug: "pull-request-reviewer-test",
        })

        expect(result.success).toBe(true)
        expect(createWorkflowMock).toHaveBeenCalledWith(
            "project-1",
            expect.objectContaining({data: expected.data, flags: expected.flags}),
        )
        expect(expected.data).toEqual(WORKFLOW_DATA)
    })
})

describe("template package loading", () => {
    it("maps a connected alternative to the slot's stable package connection key", () => {
        const template = AGENT_TEMPLATES.find((item) => item.key === "pr-reviewer")!
        const githubSlot = template.connections.find((item) => item.primary.slug === "github")!

        expect(templateConnectionChoices(template, ["gitlab"])).toContainEqual({
            connection_key: githubSlot.key,
            kind: "gateway",
            provider: "composio",
            integration: "gitlab",
        })
    })

    it("preserves the host's edited template prompt", async () => {
        const template = AGENT_TEMPLATES.find((item) => item.key === "pr-reviewer")!
        const initialMessage = "Review only security-sensitive pull requests."

        await store.set(loadAgentTemplateFromEphemeralAtom, {
            revisionId: REVISION_ID,
            template,
            initialMessage,
        })

        expect(loadAgentTemplateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                source: template.source,
                initial_message: initialMessage,
                ui_build_kit_enabled: true,
                ui_disabled_ops: [],
            }),
            expect.stringMatching(/^agent-template:/),
            "project-1",
        )
    })

    it("binds the project's usable connections and skips the rest, with no setup step", async () => {
        const template = AGENT_TEMPLATES.find((item) => item.key === "pr-reviewer")!
        queryConnectionsMock.mockResolvedValue({
            count: 2,
            connections: [
                {integration_key: "gitlab", flags: {is_active: true, is_valid: true}},
                {integration_key: "github", flags: {is_active: true, is_valid: false}},
                {integration_key: "slack", flags: {is_active: false, is_valid: true}},
            ],
        })

        await store.set(loadAgentTemplateFromEphemeralAtom, {revisionId: REVISION_ID, template})

        const githubSlot = template.connections.find((item) => item.primary.slug === "github")!
        const choices = loadAgentTemplateMock.mock.calls[0][0].connection_choices
        expect(choices).toContainEqual({
            connection_key: githubSlot.key,
            kind: "gateway",
            provider: "composio",
            integration: "gitlab",
        })
        expect(choices.filter((choice: {kind: string}) => choice.kind === "gateway")).toHaveLength(
            1,
        )
        expect(choices).toHaveLength(template.connections.length)
    })

    it("loads a source from outside the catalog without connection choices", async () => {
        const source = {
            kind: "github" as const,
            repo_url: "https://github.com/acme/templates",
            commit: "a".repeat(40),
            path: "packages/triage",
        }

        await store.set(loadAgentTemplateFromEphemeralAtom, {
            revisionId: REVISION_ID,
            source,
            initialMessage: "Set up this agent.",
        })

        expect(loadAgentTemplateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                source,
                initial_message: "Set up this agent.",
                connection_choices: [],
            }),
            expect.stringMatching(new RegExp(`^agent-template:${REVISION_ID}:[0-9a-f-]{36}$`)),
            "project-1",
        )
    })

    it("reuses one in-flight request for rapid duplicate activation", async () => {
        const template = AGENT_TEMPLATES.find((item) => item.key === "pr-reviewer")!
        let resolveLoad: ((value: AgentTemplateLoadResult) => void) | null = null
        loadAgentTemplateMock.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveLoad = resolve
                }),
        )

        const params = {revisionId: REVISION_ID, template}
        const first = store.set(loadAgentTemplateFromEphemeralAtom, params)
        const second = store.set(loadAgentTemplateFromEphemeralAtom, params)

        await vi.waitFor(() => expect(loadAgentTemplateMock).toHaveBeenCalledTimes(1))
        const result = {
            workflow_id: "loaded-workflow",
            workflow_slug: "pr-reviewer",
            variant_id: "loaded-variant",
            revision_id: "loaded-revision",
            session_id: "loaded-session",
            execution_id: "loaded-execution",
            input_id: "loaded-input",
            replayed: false,
        }
        resolveLoad!(result)

        await expect(first).resolves.toEqual(result)
        await expect(second).resolves.toEqual(result)
        expect(loadAgentTemplateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                source: template.source,
                base_revision: WORKFLOW_DATA,
                initial_message: templateBuilderMessage(template),
            }),
            expect.stringMatching(/^agent-template:/),
            "project-1",
        )
    })
})

it("retries an uncertain creation with the original key and exact payload", async () => {
    const template = AGENT_TEMPLATES.find((item) => item.key === "pr-reviewer")!
    const params = {
        revisionId: REVISION_ID,
        template,
        initialMessage: "Original request",
        stagingSessionId: "staged-session",
        attachmentIds: ["file-id"],
    }
    loadAgentTemplateMock.mockRejectedValueOnce(new Error("response lost"))
    await expect(store.set(loadAgentTemplateFromEphemeralAtom, params)).rejects.toThrow(
        "response lost",
    )
    const original = loadAgentTemplateMock.mock.calls[0]
    fetchOverlayMock.mockRejectedValue(new Error("catalog unavailable"))
    await store.set(loadAgentTemplateFromEphemeralAtom, params)
    expect(fetchOverlayMock).toHaveBeenCalledTimes(1)
    expect(loadAgentTemplateMock.mock.calls[1]).toEqual(original)
    expect(original[0]).toMatchObject({
        staging_session_id: "staged-session",
        attachment_ids: ["file-id"],
    })
})

it("recovers the saved creation intent after a page reload", async () => {
    const template = AGENT_TEMPLATES.find((item) => item.key === "pr-reviewer")!
    const request = {
        source: template.source,
        base_revision: WORKFLOW_DATA,
        initial_message: "Saved before reload",
    }
    const storage = new Map([
        [
            "agent-template-intent:project-1:pr-reviewer",
            JSON.stringify({key: "agent-template:original-draft", request}),
        ],
    ])
    vi.stubGlobal("sessionStorage", {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    })
    try {
        await store.set(loadAgentTemplateFromEphemeralAtom, {revisionId: REVISION_ID, template})
        expect(loadAgentTemplateMock).toHaveBeenCalledWith(
            request,
            "agent-template:original-draft",
            "project-1",
        )
        expect(storage.size).toBe(0)
    } finally {
        vi.unstubAllGlobals()
    }
})
