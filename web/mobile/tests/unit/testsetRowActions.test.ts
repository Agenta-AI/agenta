// @vitest-environment jsdom
import {act, createElement} from "react"

import {
    downloadTestset,
    fetchEvaluationRunIdsUsingTestsets,
    fetchLatestRevision,
    testsetMolecule,
} from "@agenta/entities/testset"
import {message} from "@agenta/ui/app-message"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {exportFileName, useTestsetRowActions} from "@/features/testsets/list/useTestsetRowActions"

const push = vi.fn()

vi.mock("next/router", () => ({useRouter: () => ({push})}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {
        info: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
        loading: vi.fn(() => vi.fn()),
    },
}))
vi.mock("@agenta/entities/testset", () => ({
    downloadTestset: vi.fn(),
    fetchEvaluationRunIdsUsingTestsets: vi.fn(),
    fetchLatestRevision: vi.fn(),
    testsetMolecule: {lifecycle: {archive: vi.fn()}},
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const row = {id: "t-alpha", name: "Alpha set / v2"}
const BASE = "/w/ws/p/pr"

type Actions = ReturnType<typeof useTestsetRowActions>
let latest: Actions | null = null
const actions = (): Actions => {
    if (!latest) throw new Error("The probe did not render")
    return latest
}

function Probe() {
    latest = useTestsetRowActions({projectId: "pr", base: BASE})
    return null
}

describe("Testset row actions", () => {
    let root: Root
    let host: HTMLDivElement
    let client: QueryClient

    beforeEach(() => {
        vi.clearAllMocks()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        client = new QueryClient()
        act(() => root.render(createElement(QueryClientProvider, {client}, createElement(Probe))))
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        client.clear()
    })

    it("Opening a testset goes to its latest saved revision", async () => {
        vi.mocked(fetchLatestRevision).mockResolvedValue({id: "rev-3", version: 3} as never)

        await act(async () => actions().openLatest(row))

        expect(fetchLatestRevision).toHaveBeenCalledWith({projectId: "pr", testsetId: "t-alpha"})
        expect(push).toHaveBeenCalledWith(`${BASE}/testsets/rev-3`)
    })

    it("Opening a testset without a saved revision shows an error and stays", async () => {
        vi.mocked(fetchLatestRevision).mockResolvedValue({id: "rev-0", version: 0} as never)

        await act(async () => actions().openLatest(row))

        expect(push).not.toHaveBeenCalled()
        expect(message.error).toHaveBeenCalledWith("This testset has no saved revision yet")
    })

    it("Opening a testset that cannot be read shows a plain error and stays", async () => {
        vi.mocked(fetchLatestRevision).mockRejectedValue(new Error("Request failed with 500"))

        await act(async () => actions().openLatest(row))

        expect(push).not.toHaveBeenCalled()
        expect(message.error).toHaveBeenCalledWith("Couldn't open this testset")
    })

    it("Export uses the sanitized name and the chosen format", async () => {
        vi.mocked(downloadTestset).mockResolvedValue({} as never)

        await act(async () => actions().exportTestset(row, "json"))

        expect(exportFileName("Alpha set / v2", "json")).toBe("Alpha-set---v2.json")
        expect(downloadTestset).toHaveBeenCalledWith({
            projectId: "pr",
            testsetId: "t-alpha",
            fileType: "json",
            filename: "Alpha-set---v2.json",
        })
        expect(message.success).toHaveBeenCalledWith("Testset exported as JSON")
    })

    it("A failed export shows Failed to export", async () => {
        vi.mocked(downloadTestset).mockRejectedValue(new Error("Request failed with 500"))

        await act(async () => actions().exportTestset(row, "csv"))

        expect(message.error).toHaveBeenCalledWith("Failed to export")
        expect(message.success).not.toHaveBeenCalled()
    })

    it("Archive is refused with a message when an evaluation uses the testset", async () => {
        vi.mocked(fetchEvaluationRunIdsUsingTestsets).mockResolvedValue(["run-1", "run-2"])

        await act(async () => {
            await expect(actions().archive(row)).rejects.toThrow(
                "The testset is used by 2 evaluations. Archive or delete the evaluations first.",
            )
        })
        expect(testsetMolecule.lifecycle.archive).not.toHaveBeenCalled()
    })

    it("Archive says evaluation in the singular for one run", async () => {
        vi.mocked(fetchEvaluationRunIdsUsingTestsets).mockResolvedValue(["run-1"])

        await act(async () => {
            await expect(actions().archive(row)).rejects.toThrow(
                "The testset is used by 1 evaluation. Archive or delete the evaluation first.",
            )
        })
    })

    it("Archive success shows Testset archived and refreshes the testsets keys", async () => {
        vi.mocked(fetchEvaluationRunIdsUsingTestsets).mockResolvedValue([])
        vi.mocked(testsetMolecule.lifecycle.archive).mockResolvedValue(undefined)
        const invalidate = vi.spyOn(client, "invalidateQueries")

        await act(async () => actions().archive(row))

        expect(testsetMolecule.lifecycle.archive).toHaveBeenCalledWith(["t-alpha"], {
            projectId: "pr",
        })
        expect(message.success).toHaveBeenCalledWith("Testset archived")
        expect(invalidate).toHaveBeenCalledWith({queryKey: ["testsets"]})
    })

    it("Archive keeps the dialog open when the row is busy opening", async () => {
        let finish: (value: never) => void = () => undefined
        vi.mocked(fetchLatestRevision).mockReturnValue(new Promise((resolve) => (finish = resolve)))
        vi.mocked(fetchEvaluationRunIdsUsingTestsets).mockResolvedValue([])

        await act(async () => void actions().openLatest(row))
        await act(async () => {
            await expect(actions().archive(row)).rejects.toThrow("This testset is busy")
        })
        expect(testsetMolecule.lifecycle.archive).not.toHaveBeenCalled()
        await act(async () => finish({id: "rev-1", version: 1} as never))
    })

    it("A failed archive shows Couldn't archive this testset", async () => {
        vi.mocked(fetchEvaluationRunIdsUsingTestsets).mockResolvedValue([])
        vi.mocked(testsetMolecule.lifecycle.archive).mockRejectedValue(
            new Error("Request failed with 500"),
        )

        await act(async () => {
            await expect(actions().archive(row)).rejects.toThrow("Couldn't archive this testset")
        })
        expect(message.success).not.toHaveBeenCalled()
    })
})
