import {describe, expect, it} from "vitest"

import {
    buildAgentModelCandidates,
    explicitAgentConnection,
    resolveAgentModelSelection,
} from "../../src/secret/core/agentModelCandidates"
import {isOrganizationConnection, toProviderConnections} from "../../src/secret/core/connections"
import {projectRowsOnly, transformSecret} from "../../src/secret/core/transforms"
import {SecretKind, StandardProviderKind, type SecretResponseDto} from "../../src/secret/core/types"
import {loginAttemptKey} from "../../src/secret/state/subscriptionLogin"

const openaiSecret = (overrides: Record<string, unknown> = {}): SecretResponseDto =>
    ({
        id: "project-row",
        slug: "openai-abc",
        kind: SecretKind.ProviderKey,
        header: {name: "OpenAI"},
        data: {kind: StandardProviderKind.Openai, provider: {}},
        value_status: {configured: true, preview: "sk-****1234"},
        ...overrides,
    }) as unknown as SecretResponseDto

const organizationSecret = (overrides: Record<string, unknown> = {}) =>
    openaiSecret({
        id: "org-row",
        slug: "openai-organization-def",
        header: {name: "OpenAI (Organization)"},
        owner: {kind: "organization", id: "org-1"},
        value_status: {configured: true},
        ...overrides,
    })

describe("organization rows in the vault read", () => {
    it("marks an organization row with its owner and who may use it", () => {
        const [project, organization] = transformSecret([
            openaiSecret(),
            organizationSecret({
                availability: "selected_projects",
                selected_project_ids: ["p1", "p2"],
            }),
        ])

        expect(project.ownerKind).toBeUndefined()
        expect(organization.ownerKind).toBe("organization")
        expect(organization.availability).toBe("selected_projects")
        expect(organization.selectedProjectIds).toEqual(["p1", "p2"])
    })

    it("gives a connection the organization scope, and none to a project row", () => {
        const [project, organization] = toProviderConnections(
            transformSecret([openaiSecret(), organizationSecret({availability: "all_projects"})]),
        )

        expect(isOrganizationConnection(project)).toBe(false)
        expect(project.scope).toBeUndefined()
        expect(isOrganizationConnection(organization)).toBe(true)
        expect(organization.availability).toBe("all_projects")
        expect(organization.keyPreview).toBeUndefined()
    })

    it("keeps organization rows away from every project-only reader", () => {
        const rows = transformSecret([openaiSecret(), organizationSecret()])
        expect(projectRowsOnly(rows).map((row) => row.id)).toEqual(["project-row"])

        // No organization row: the very same array, so readers keep a stable reference.
        const projectOnly = transformSecret([openaiSecret()])
        expect(projectRowsOnly(projectOnly)).toBe(projectOnly)
    })
})

describe("explicitAgentConnection for an organization connection", () => {
    it("names scope and namespace organization for a key", () => {
        expect(
            explicitAgentConnection({mode: "agenta", slug: "openai-org", scope: "organization"}),
        ).toEqual({
            mode: "agenta",
            slug: "openai-org",
            scope: "organization",
            namespace: "organization",
        })
    })

    it("reads namespace organization as the organization scope", () => {
        expect(
            explicitAgentConnection({
                mode: "agenta",
                slug: "openai-org",
                namespace: "organization",
            }),
        ).toEqual({
            mode: "agenta",
            slug: "openai-org",
            scope: "organization",
            namespace: "organization",
        })
    })

    it("names an organization subscription login in self_managed mode", () => {
        expect(
            explicitAgentConnection({
                mode: "self_managed",
                slug: "chatgpt",
                namespace: "organization",
            }),
        ).toEqual({
            mode: "self_managed",
            slug: "chatgpt",
            scope: "organization",
            namespace: "organization",
        })
    })

    it("keeps a project subscription login as it was", () => {
        expect(explicitAgentConnection({mode: "self_managed", slug: "chatgpt"})).toEqual({
            mode: "self_managed",
            slug: "chatgpt",
        })
    })
})

describe("agent model candidates from an organization connection", () => {
    const capabilities = {
        pi_core: {
            providers: ["openai"],
            connection_modes: ["agenta", "self_managed"],
            model_selection: "provider/id",
            models: {openai: ["openai/gpt-5"]},
            default_models: {openai: ["openai/gpt-5"]},
        },
    }

    it("names the organization connection by scope, namespace and stored slug", () => {
        const connections = toProviderConnections(
            transformSecret([openaiSecret(), organizationSecret()]),
        )
        const candidates = buildAgentModelCandidates({
            connections,
            capabilities,
            harnessIds: ["pi_core"],
            showSubscriptions: false,
        })

        const project = candidates.find((candidate) => candidate.connectionKey === "project-row")
        const organization = candidates.find((candidate) => candidate.connectionKey === "org-row")
        expect(project?.scope).toBeUndefined()
        expect(project?.namespace).toBeUndefined()
        expect(organization).toMatchObject({
            slug: "openai-organization-def",
            scope: "organization",
            namespace: "organization",
            mode: "agenta",
        })
    })

    it("lists organization routes last and never picks one by default", () => {
        const onlyOrganization = toProviderConnections(transformSecret([organizationSecret()]))
        const candidates = buildAgentModelCandidates({
            connections: onlyOrganization,
            capabilities,
            harnessIds: ["pi_core"],
            showSubscriptions: false,
        })
        expect(candidates.length).toBeGreaterThan(0)
        expect(resolveAgentModelSelection({candidates})).toBeNull()
        // A pick the builder made is kept.
        expect(resolveAgentModelSelection({candidates, explicit: candidates[0]})).toBe(
            candidates[0],
        )

        const both = buildAgentModelCandidates({
            connections: toProviderConnections(
                transformSecret([organizationSecret(), openaiSecret()]),
            ),
            capabilities,
            harnessIds: ["pi_core"],
            showSubscriptions: false,
        })
        expect(both[0].connectionKey).toBe("project-row")
        expect(both[both.length - 1].connectionKey).toBe("org-row")
        expect(resolveAgentModelSelection({candidates: both})?.connectionKey).toBe("project-row")
    })

    it("offers no route for an organization row without a slug", () => {
        const connections = toProviderConnections(
            transformSecret([organizationSecret({slug: null})]),
        )
        expect(
            buildAgentModelCandidates({
                connections,
                capabilities,
                harnessIds: ["pi_core"],
                showSubscriptions: false,
            }),
        ).toEqual([])
    })
})

describe("loginAttemptKey with a scope", () => {
    it("keeps a project key as it was, and marks an organization one", () => {
        const base = {secretId: "s", attemptId: "a", startedAt: 1}
        expect(loginAttemptKey(base)).toBe("s|a|1")
        expect(loginAttemptKey({...base, scope: "organization"})).toBe("s|a|1|organization")
    })
})
