/**
 * An OpenAI-compatible endpoint that needs no key at all.
 *
 * The provider card treats such an endpoint as a complete connection: its base URL is what is
 * required, its key field is labelled "API key — if the endpoint requires one", and the
 * providers table reports the saved row as active. The API agrees, registering it as an active
 * LLM gateway endpoint. The agent's model picker did not, dropping every connection with no
 * stored secret, so the endpoint was never selectable and the agent went on asking for a key
 * the card calls optional (QA-D5).
 *
 * The row below is the one the demo stack actually stored for that report, transformed by the
 * same code the page runs, so the case is the reported case rather than a reconstruction.
 */
import {describe, expect, it} from "vitest"

import {buildAgentModelCandidates} from "../../src/secret/core/agentModelCandidates"
import {
    connectionRunsWithoutCredential,
    toProviderConnections,
    type ProviderConnection,
} from "../../src/secret/core/connections"
import {transformSecret} from "../../src/secret/core/transforms"
import {resolveAgentModelCandidateSources} from "../../src/workflow/state/agentModelCandidates"

/** The shipped catalogue: Pi speaks OpenAI, Claude Code speaks Anthropic. */
const CAPABILITIES = {
    pi_core: {
        providers: ["openai", "anthropic", "gemini"],
        deployments: ["direct", "custom"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "provider/id",
    },
    claude: {
        providers: ["anthropic"],
        deployments: ["direct", "custom", "bedrock", "vertex_ai", "vertex"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "alias",
    },
} as never

const HARNESSES = ["pi_core", "claude"]

/** `GET /vault/v1/secrets/` for the connection the QA run saved, key field left empty. */
const savedRow = (configured: boolean) => ({
    slug: "mock-llm-46aaf400a8fb",
    id: "01a0a93d-7256-7d32-8988-bd941b27fc86",
    kind: "custom_provider",
    data: {
        kind: "custom",
        provider: {url: "http://mock-llm-gateway:9091/v1", extras: {}},
        models: [{slug: "mock/echo"}],
        protocol: "anthropic",
        provider_slug: "mock-llm",
        model_keys: ["mock-llm/custom/mock/echo"],
    },
    header: {name: "mock-llm"},
    lifecycle: {created_at: "2026-09-16 08:02:51+00:00", updated_at: null},
    write_only: true,
    value_status: {configured},
})

const connectionFor = (configured: boolean): ProviderConnection =>
    toProviderConnections(transformSecret([savedRow(configured)] as never) as never)[0]

const candidatesFor = (connection: ProviderConnection) =>
    buildAgentModelCandidates({
        connections: [connection],
        capabilities: CAPABILITIES,
        harnessIds: HARNESSES,
        showSubscriptions: false,
    })

describe("an open endpoint saved with no key", () => {
    it("arrives from the API holding no credential", () => {
        // The premise: this is not a broken save, it is the save the card offers.
        expect(connectionFor(false).hasStoredCredential).toBe(false)
    })

    it("is offered to the harness its declared protocol admits", () => {
        const candidates = candidatesFor(connectionFor(false))

        expect(candidates).toEqual([
            {
                modelId: "mock-llm/custom/mock/echo",
                provider: "anthropic",
                mode: "agenta",
                slug: "mock-llm-46aaf400a8fb",
                harness: "claude",
                source: "connection",
                connectionKey: "01a0a93d-7256-7d32-8988-bd941b27fc86",
                managed: false,
            },
        ])
    })

    it("is offered exactly as the same endpoint holding a key would be", () => {
        // The key is the conditional part, so having one changes nothing about the routes.
        expect(candidatesFor(connectionFor(false))).toEqual(candidatesFor(connectionFor(true)))
    })

    it("clears the connect-a-model gate, which is what showed the banner", () => {
        // The state layer from the two raw API payloads down. The banner's rule is
        // `candidateCount === 0` once the sources are ready, so one candidate here is the
        // banner going away and the composer unblocking.
        const resolved = resolveAgentModelCandidateSources({
            // What `fetchVaultSecret` hands the query: the API rows, already transformed.
            vaultRows: transformSecret([savedRow(false)] as never) as never,
            capabilities: CAPABILITIES,
            subscriptionSettled: true,
            showSubscriptions: false,
        })

        expect(resolved.status).toBe("ready")
        expect(resolved.candidates).toHaveLength(1)
        expect(resolved.candidates[0].harness).toBe("claude")
    })
})

describe("connectionRunsWithoutCredential", () => {
    const connection = (overrides: Partial<ProviderConnection>): ProviderConnection =>
        ({
            id: "conn",
            name: "Connection",
            kind: "custom",
            title: "OpenAI-compatible endpoint",
            secretKind: "custom_provider",
            hasStoredCredential: false,
            source: {apiBaseUrl: "https://gw.example.com/v1"},
            ...overrides,
        }) as unknown as ProviderConnection

    it("accepts an endpoint that has its address", () => {
        expect(connectionRunsWithoutCredential(connection({}))).toBe(true)
    })

    it("refuses an endpoint with no address, which there is nothing to dial", () => {
        expect(connectionRunsWithoutCredential(connection({source: {} as never}))).toBe(false)
    })

    it("refuses every kind whose credential is the point", () => {
        // A provider key, a cloud deployment that requires one, and an either-or auth pair.
        for (const kind of ["openai", "anthropic", "azure", "vertex_ai", "bedrock"]) {
            expect(
                connectionRunsWithoutCredential(
                    connection({
                        kind,
                        secretKind: (kind === "openai" || kind === "anthropic"
                            ? "provider_key"
                            : "custom_provider") as never,
                    }),
                ),
                kind,
            ).toBe(false)
        }
    })

    it("keeps a keyless row of those kinds out of the picker", () => {
        const candidates = buildAgentModelCandidates({
            connections: [
                connection({
                    kind: "openai",
                    secretKind: "provider_key" as never,
                    models: ["gpt-5"],
                    source: {} as never,
                }),
            ],
            capabilities: CAPABILITIES,
            harnessIds: HARNESSES,
            showSubscriptions: false,
        })

        expect(candidates).toEqual([])
    })
})
