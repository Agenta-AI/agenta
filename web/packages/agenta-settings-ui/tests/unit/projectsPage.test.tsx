// @vitest-environment jsdom
/**
 * The Projects row menu. The Settings redesign dropped "Set as default", and Delete is
 * disabled on the default project, so the default could be neither moved nor removed.
 */
import type {ProjectsResponse} from "@agenta/entities/project"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const api = vi.hoisted(() => ({
    createProject: vi.fn(),
    deleteProject: vi.fn(),
    patchProject: vi.fn(),
}))
vi.mock("@agenta/entities/project", () => api)

import {ProjectsPage} from "../../src/projects/ProjectsPage"

// jsdom has no PointerEvent or pointer capture, and the Radix menu trigger needs both.
if (!(globalThis as {PointerEvent?: unknown}).PointerEvent) {
    class StubPointerEvent extends MouseEvent {
        constructor(type: string, init: MouseEventInit = {}) {
            super(type, init)
        }
    }
    ;(globalThis as {PointerEvent?: unknown}).PointerEvent = StubPointerEvent
}
for (const method of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"]) {
    if (!(method in Element.prototype)) {
        Object.defineProperty(Element.prototype, method, {value: () => false, writable: true})
    }
}

const project = (over: Partial<ProjectsResponse>): ProjectsResponse =>
    ({
        workspace_id: "ws-1",
        user_role: "owner",
        is_default_project: false,
        is_demo: false,
        ...over,
    }) as ProjectsResponse

const PROJECTS = [
    project({project_id: "p-default", project_name: "Main", is_default_project: true}),
    project({project_id: "p-other", project_name: "Side"}),
]

const show = () => {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const invalidate = vi.spyOn(client, "invalidateQueries")
    render(
        <QueryClientProvider client={client}>
            <ProjectsPage
                projects={PROJECTS}
                isLoading={false}
                workspaceId="ws-1"
                currentProjectId="p-default"
                onSwitch={vi.fn()}
                renderCreateDialog={() => null}
                renderDeleteDialog={() => null}
            />
        </QueryClientProvider>,
    )
    return {invalidate}
}

/** Radix opens the menu on pointerdown, not click. */
const openRowMenu = (name: string) => {
    const row = screen.getByText(name).closest('[role="button"]') as HTMLElement
    const kebab = within(row).getByRole("button", {name: "Project actions"})
    act(() => {
        fireEvent.pointerDown(kebab, {bubbles: true, button: 0, ctrlKey: false})
    })
}

beforeEach(() => {
    vi.clearAllMocks()
    api.patchProject.mockResolvedValue({})
})

afterEach(cleanup)

describe("ProjectsPage Set as default", () => {
    it("offers Set as default on a project that is not the default", () => {
        show()
        openRowMenu("Side")
        expect(screen.getByRole("menuitem", {name: "Set as default"})).toBeTruthy()
    })

    it("hides Set as default on the default project", () => {
        show()
        openRowMenu("Main")
        expect(screen.getAllByRole("menuitem").length).toBeGreaterThan(0)
        expect(screen.queryByRole("menuitem", {name: "Set as default"})).toBeNull()
    })

    it("makes the chosen project the default and refreshes the list", async () => {
        const {invalidate} = show()
        openRowMenu("Side")
        act(() => {
            fireEvent.click(screen.getByRole("menuitem", {name: "Set as default"}))
        })
        await waitFor(() => expect(api.patchProject).toHaveBeenCalledTimes(1))
        expect(api.patchProject).toHaveBeenCalledWith("p-other", {make_default: true})
        await waitFor(() => expect(invalidate).toHaveBeenCalledWith({queryKey: ["projects"]}))
    })
})
