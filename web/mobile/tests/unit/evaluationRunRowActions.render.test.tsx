// @vitest-environment jsdom
import {act, createElement} from "react"

import type {EvaluationRun} from "@agenta/entities/evaluationRun"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {RunRowMenu} from "@/features/evaluations/list/RunRowMenu"
import {useRunRowActions} from "@/features/evaluations/list/useRunRowActions"

import {makeRun} from "./evaluationRunsFixtures"

const http = vi.hoisted(() => ({post: vi.fn(), delete: vi.fn()}))
const toast = vi.hoisted(() => ({success: vi.fn(), error: vi.fn()}))
const env = vi.hoisted(() => ({
    permissions: {edit_evaluation_runs: true} as Record<string, boolean>,
    testsetsOn: false,
    push: vi.fn(),
    replace: vi.fn(),
    query: {} as Record<string, string | undefined>,
}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: http,
    getAgentaApiUrl: () => "https://api.test",
}))
vi.mock("@agenta/ui/app-message", () => ({message: toast}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: env.query,
        pathname: "/evaluations",
        push: env.push,
        replace: env.replace,
    }),
}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: (_project: string, action: string) => env.permissions[action] ?? false,
}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: () => env.testsetsOn,
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root
let client: QueryClient

const Host = ({run}: {run: EvaluationRun}) => {
    const actions = useRunRowActions({projectId: "pr", base: "/w/ws/p/pr"})
    return createElement("div", null, createElement(RunRowMenu, {run, actions}), actions.modal)
}

const settle = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })

const mount = async (run: EvaluationRun) => {
    await act(async () =>
        root.render(createElement(QueryClientProvider, {client}, createElement(Host, {run}))),
    )
}

const openMenu = async () => {
    const trigger = host.querySelector("[aria-label='Run actions']")
    await act(async () => {
        trigger?.dispatchEvent(
            new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}),
        )
    })
}

const items = () =>
    [...document.querySelectorAll("[role=menuitem]")].map((el) => el.textContent?.trim())

const clickItem = async (label: string) => {
    const item = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find(
        (el) => el.textContent?.trim() === label,
    )
    await act(async () => item?.click())
}

const confirmButton = () =>
    [...document.querySelectorAll<HTMLButtonElement>("[role=alertdialog] button")].find(
        (button) => button.textContent === "Delete",
    )

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    for (const fn of [http.post, http.delete, ...Object.values(toast), env.push, env.replace]) {
        fn.mockReset()
    }
    env.permissions = {edit_evaluation_runs: true}
    env.testsetsOn = false
    env.query = {}
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("run row actions", () => {
    it("Delete sends one DELETE with the run id after the confirm", async () => {
        http.delete.mockResolvedValue({data: {run_ids: ["r1"]}})
        const invalidate = vi.spyOn(client, "invalidateQueries")
        await mount(makeRun("r1", {status: "running"}))
        await openMenu()
        await clickItem("Delete")
        expect(http.delete).not.toHaveBeenCalled()
        expect(document.body.textContent).toContain("Are you sure you want to delete?")
        expect(document.body.textContent).toContain("A deleted evaluation cannot be restored.")
        expect(document.body.textContent).toContain("Run r1")
        await act(async () => confirmButton()?.click())
        await settle()
        expect(http.delete).toHaveBeenCalledTimes(1)
        expect(http.delete).toHaveBeenCalledWith("https://api.test/evaluations/runs/", {
            params: {project_id: "pr"},
            data: {run_ids: ["r1"]},
        })
        expect(toast.success).toHaveBeenCalledWith("Deleted successfully")
        expect(invalidate).toHaveBeenCalledWith({queryKey: ["evaluation-runs", "list"]})
    })

    it("A second Delete click while the first runs sends nothing", async () => {
        let finish: (value: unknown) => void = () => undefined
        http.delete.mockReturnValue(new Promise((resolve) => (finish = resolve)))
        await mount(makeRun("r1"))
        await openMenu()
        await clickItem("Delete")
        const button = confirmButton()
        await act(async () => button?.click())
        await act(async () => button?.click())
        expect(http.delete).toHaveBeenCalledTimes(1)
        await act(async () => finish({data: {run_ids: ["r1"]}}))
        await settle()
        expect(http.delete).toHaveBeenCalledTimes(1)
    })

    it("A failed delete keeps the confirm open with the error and Delete, and keeps the row", async () => {
        http.delete.mockRejectedValue(new Error("boom"))
        client.setQueryData(["evaluationRun", "r1"], makeRun("r1"))
        const invalidate = vi.spyOn(client, "invalidateQueries")
        await mount(makeRun("r1"))
        await openMenu()
        await clickItem("Delete")
        await act(async () => confirmButton()?.click())
        await settle()
        expect(document.body.textContent).toContain("Failed to delete evaluations")
        expect(confirmButton()).toBeDefined()
        expect(toast.success).not.toHaveBeenCalled()
        expect(invalidate).not.toHaveBeenCalled()
        expect(client.getQueryData(["evaluationRun", "r1"])).toBeDefined()
    })

    it("Delete is offered at every status", async () => {
        for (const status of ["pending", "queued", "running", "success", "failure"]) {
            await mount(makeRun("r1", {status}))
            await openMenu()
            expect(items()).toContain("Delete")
            await act(async () =>
                document.dispatchEvent(
                    new KeyboardEvent("keydown", {key: "Escape", bubbles: true}),
                ),
            )
        }
    })

    it("Stop on an active live run posts to the stop path and shows Evaluation stopped", async () => {
        http.post.mockResolvedValue({data: {evaluation: {id: "r1"}}})
        await mount(makeRun("r1", {live: true, status: "running", flags: {is_active: true}}))
        await openMenu()
        expect(items()).toContain("Stop evaluation")
        await clickItem("Stop evaluation")
        await settle()
        expect(http.post).toHaveBeenCalledTimes(1)
        expect(http.post.mock.calls[0][0]).toBe("https://api.test/simple/evaluations/r1/stop")
        expect(toast.success).toHaveBeenCalledWith("Evaluation stopped")
    })

    it("Resume on an inactive live run posts to the start path", async () => {
        http.post.mockResolvedValue({data: {evaluation: {id: "r1"}}})
        await mount(makeRun("r1", {live: true, flags: {is_active: false}}))
        await openMenu()
        expect(items()).not.toContain("Stop evaluation")
        await clickItem("Resume evaluation")
        await settle()
        expect(http.post.mock.calls[0][0]).toBe("https://api.test/simple/evaluations/r1/start")
        expect(toast.success).toHaveBeenCalledWith("Evaluation resumed")
    })

    it("A closed live run offers neither Stop nor Resume", async () => {
        await mount(makeRun("r1", {live: true, flags: {is_active: false, is_closed: true}}))
        await openMenu()
        expect(items().some((label) => /Stop|Resume/.test(label ?? ""))).toBe(false)
    })

    it("A failed stop shows Failed to stop evaluation", async () => {
        http.post.mockRejectedValue(new Error("boom"))
        await mount(makeRun("r1", {live: true, flags: {is_active: true}}))
        await openMenu()
        await clickItem("Stop evaluation")
        await settle()
        expect(toast.error).toHaveBeenCalledWith("Failed to stop evaluation")
    })

    it("A reader without edit rights gets no delete and no stop", async () => {
        env.permissions = {}
        await mount(makeRun("r1", {live: true, flags: {is_active: true}}))
        await openMenu()
        expect(items()).toEqual(["Open details", "Copy run ID"])
    })

    it("The menu has no Edit evaluation and no Export row", async () => {
        await mount(makeRun("r1"))
        await openMenu()
        expect(items().some((label) => /Edit|Export/.test(label ?? ""))).toBe(false)
    })

    describe("references", () => {
        const refs = {
            application_revision: {id: "rev-1"},
            testset: {id: "ts-1"},
            testset_revision: {id: "ts-rev-1"},
        }

        it("View test set uses the test set revision id when the run has one", async () => {
            env.testsetsOn = true
            await mount(makeRun("r1", {references: refs}))
            await openMenu()
            await clickItem("View test set")
            expect(env.push).toHaveBeenCalledWith("/w/ws/p/pr/testsets/ts-rev-1")
        })

        it("View test set falls back to the test set id", async () => {
            env.testsetsOn = true
            await mount(makeRun("r1", {references: {testset: {id: "ts-1"}}}))
            await openMenu()
            await clickItem("View test set")
            expect(env.push).toHaveBeenCalledWith("/w/ws/p/pr/testsets/ts-1")
        })

        it("View test set is absent while the testsets view is off", async () => {
            await mount(makeRun("r1", {references: refs}))
            await openMenu()
            expect(items()).not.toContain("View test set")
        })

        it("View variant opens the revision in the URL", async () => {
            await mount(makeRun("r1", {references: refs}))
            await openMenu()
            await clickItem("View variant")
            expect(env.replace).toHaveBeenCalledWith(
                {pathname: "/evaluations", query: {revisionId: "rev-1"}},
                undefined,
                {shallow: true},
            )
        })

        it("Open details goes to the run page", async () => {
            await mount(makeRun("r1"))
            await openMenu()
            await clickItem("Open details")
            expect(env.push).toHaveBeenCalledWith("/w/ws/p/pr/evaluations/results/r1")
        })
    })
})
