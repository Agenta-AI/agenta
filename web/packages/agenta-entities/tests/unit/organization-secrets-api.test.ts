import {beforeEach, describe, expect, it, vi} from "vitest"

const secrets = {
    listSecrets: vi.fn(),
    createSecret: vi.fn(),
    setSecretProjects: vi.fn(),
}
const projects = {getProjects: vi.fn()}

vi.mock("@agenta/sdk/resources", () => ({
    getSecretsClient: () => secrets,
    getProjectsClient: () => projects,
}))

const {
    createOrganizationSecret,
    fetchOrganizationProjects,
    fetchOrganizationSecrets,
    setOrganizationSecretProjects,
} = await import("../../src/secret/api/organizationSecrets")

const scoped = {queryParams: {project_id: "p1"}}

describe("organization connections on the /secrets/ routes", () => {
    beforeEach(() => vi.clearAllMocks())

    it("lists the organization's connections with the organization scope", async () => {
        secrets.listSecrets.mockResolvedValue([])
        await fetchOrganizationSecrets({projectId: "p1"})
        expect(secrets.listSecrets).toHaveBeenCalledWith({scope: "organization"}, scoped)
    })

    it("creates with the organization scope and sends project ids only for selected projects", async () => {
        secrets.createSecret.mockResolvedValue({id: "s1"})
        const payload = {header: {name: "OpenAI"}, secret: {kind: "provider_key"}} as never
        await createOrganizationSecret({
            projectId: "p1",
            payload,
            projects: {availability: "all_projects", projectIds: ["ignored"]},
        })
        expect(secrets.createSecret).toHaveBeenCalledWith(
            {
                header: {name: "OpenAI"},
                secret: {kind: "provider_key"},
                scope: "organization",
                availability: "all_projects",
                project_ids: [],
            },
            scoped,
        )
    })

    it("limits a connection on its projects route", async () => {
        secrets.setSecretProjects.mockResolvedValue({})
        await setOrganizationSecretProjects({
            projectId: "p1",
            secretId: "s1",
            projects: {availability: "selected_projects", projectIds: ["a", "b"]},
        })
        expect(secrets.setSecretProjects).toHaveBeenCalledWith(
            {secret_id: "s1", availability: "selected_projects", project_ids: ["a", "b"]},
            scoped,
        )
    })

    it("reads every project of the organization for the project choice", async () => {
        projects.getProjects.mockResolvedValue([
            {project_id: "a", project_name: "Sales"},
            {project_id: "b", project_name: "Marketing"},
        ])
        expect(await fetchOrganizationProjects({projectId: "p1"})).toEqual([
            {id: "a", name: "Sales"},
            {id: "b", name: "Marketing"},
        ])
        expect(projects.getProjects).toHaveBeenCalledWith({scope: "organization"}, scoped)
    })
})
