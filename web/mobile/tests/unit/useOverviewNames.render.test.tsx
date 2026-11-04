// @vitest-environment jsdom
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {describe, expect, it, vi} from "vitest"

const reads = vi.hoisted(() => ({count: 0}))
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    return {
        workflowArtifactQueryAtomFamily: (id: string) =>
            atom(() => {
                reads.count += 1
                return {data: {name: `Name ${id}`}}
            }),
        workflowMolecule: {selectors: {variantLabel: () => atom(() => "v1")}},
    }
})
vi.mock("@agenta/entities/testset", async () => {
    const {atom} = await import("jotai")
    return {testsetQueryAtomFamily: (id: string) => atom(() => ({data: {name: `Set ${id}`}}))}
})
vi.mock("@agenta/entities/evaluationRun", () => ({}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

import {
    useOverviewNames,
    type OverviewNames,
} from "@/features/evaluation-run/overview/useRunOverview"

describe("useOverviewNames", () => {
    it("Names stay the same object while the ids do not change", () => {
        const seen: OverviewNames[] = []
        const Probe = ({evaluatorIds}: {evaluatorIds: string[]}) => {
            seen.push(
                useOverviewNames({
                    evaluatorIds,
                    testsetIds: ["t1"],
                    applicationId: "app",
                    revisionId: "rev",
                }),
            )
            return null
        }
        const host = document.createElement("div")
        const root = createRoot(host)
        act(() => root.render(createElement(Probe, {evaluatorIds: ["e1", "e1"]})))
        const readsAfterFirst = reads.count
        // A poll gives the hook new arrays with the same ids.
        act(() => root.render(createElement(Probe, {evaluatorIds: ["e1"]})))
        act(() => root.render(createElement(Probe, {evaluatorIds: ["e1"]})))

        expect(seen[0].evaluators).toEqual({e1: "Name e1"})
        expect(seen[0].testsets).toEqual(["Set t1"])
        expect(seen.at(-1)).toBe(seen[0])
        expect(reads.count).toBe(readsAfterFirst)

        act(() => root.render(createElement(Probe, {evaluatorIds: ["e1", "e2"]})))
        expect(seen.at(-1)?.evaluators).toEqual({e1: "Name e1", e2: "Name e2"})
        act(() => root.unmount())
    })
})
