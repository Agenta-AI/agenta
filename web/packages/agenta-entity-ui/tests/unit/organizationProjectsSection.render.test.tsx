// "Projects that can use it" on an organization connection (M5): the three deployment shapes and
// the two warnings, in the design's words.
import {act} from "react"

import type {OrganizationSecretProjects} from "@agenta/entities/secret"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import OrganizationProjectsSection, {
    type OrganizationConnectionScope,
} from "../../src/secretProvider/OrganizationProjectsSection"

const PROJECTS = [
    {id: "support", name: "Support"},
    {id: "sales", name: "Sales"},
    {id: "marketing", name: "Marketing"},
]

const scope = (
    projectChoice: OrganizationConnectionScope["projectChoice"],
): OrganizationConnectionScope => ({
    name: "Acme Corp",
    projects: PROJECTS,
    projectChoice,
    plansHref: "/plans",
})

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const render = async (
    choice: OrganizationConnectionScope["projectChoice"],
    value: OrganizationSecretProjects,
    saved: OrganizationSecretProjects | null = null,
    onChange = vi.fn(),
) => {
    await act(async () => {
        root.render(
            <OrganizationProjectsSection
                scope={scope(choice)}
                value={value}
                onChange={onChange}
                saved={saved}
            />,
        )
    })
    return onChange
}

const text = () => host.textContent ?? ""
const radios = () => [...host.querySelectorAll<HTMLButtonElement>("button[role=radio]")]

describe("OrganizationProjectsSection", () => {
    it("says every project and offers no choice in OSS", async () => {
        await render("all", {availability: "all_projects", projectIds: []})
        expect(text()).toContain("Projects that can use it")
        expect(text()).toContain("Every project in Acme Corp.")
        expect(radios()).toHaveLength(0)
    })

    it("starts on All projects and disables Selected without the RBAC entitlement", async () => {
        await render("plan", {availability: "all_projects", projectIds: []})
        expect(text()).toContain("Every project in Acme Corp, including new ones.")
        expect(text()).toContain("Choosing projects is available on Business and Enterprise plans.")
        expect(text()).toContain("See plans")
        const [all, selected] = radios()
        expect(all.getAttribute("aria-checked")).toBe("true")
        expect(selected.disabled).toBe(true)
    })

    it("warns while no project is picked", async () => {
        await render("choose", {availability: "selected_projects", projectIds: []})
        expect(text()).toContain("Pick projects")
        expect(text()).toContain("No project can use this connection until you pick one.")
    })

    it("shows the picked projects as chips and removes one on its cross", async () => {
        const onChange = await render("choose", {
            availability: "selected_projects",
            projectIds: ["support", "sales"],
        })
        expect(text()).toContain("Support")
        expect(text()).toContain("Sales")
        const remove = host.querySelector<HTMLButtonElement>('button[aria-label="Remove Sales"]')
        await act(async () => remove?.click())
        expect(onChange).toHaveBeenCalledWith({
            availability: "selected_projects",
            projectIds: ["support"],
        })
    })

    it("says what a save takes away from each project", async () => {
        await render(
            "choose",
            {availability: "selected_projects", projectIds: ["support"]},
            {availability: "selected_projects", projectIds: ["support", "sales"]},
        )
        expect(text()).toContain(
            "Sales can no longer use this connection after you save. Agents in Sales that use it will need configuration.",
        )
        expect(text()).not.toContain("Support can no longer")
    })
})
