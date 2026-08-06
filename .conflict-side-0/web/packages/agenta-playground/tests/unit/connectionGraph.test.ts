import {describe, expect, it} from "vitest"

import {pruneDanglingConnections} from "../../src/state/helpers/connectionGraph"
import type {OutputConnection, PlaygroundNode} from "../../src/state/types"

function node(id: string, depth: number): PlaygroundNode {
    return {id, entityType: "workflow", entityId: `entity-${id}`, label: id, depth}
}

function connection(id: string, sourceNodeId: string, targetNodeId: string): OutputConnection {
    return {
        id,
        sourceNodeId,
        targetNodeId,
        sourceOutputKey: "output",
        inputMappings: [],
        parallel: true,
    }
}

describe("pruneDanglingConnections", () => {
    // Regression: changePrimaryNode swaps the primary node in place (same node
    // id), so the app → evaluator edge must survive an app-revision change.
    // Previously the controller cleared all connections here, orphaning the
    // evaluator so it silently stopped running.
    it("preserves the app → evaluator edge when the primary node is swapped in place", () => {
        const nodes = [node("N0", 0), node("N1", 1)]
        const connections = [connection("conn-1", "N0", "N1")]

        expect(pruneDanglingConnections(connections, nodes)).toEqual(connections)
    })

    it("drops connections whose source node no longer exists", () => {
        const nodes = [node("N0", 0), node("N1", 1)]
        const connections = [
            connection("conn-1", "N0", "N1"),
            connection("conn-stale", "GONE", "N1"),
        ]

        expect(pruneDanglingConnections(connections, nodes)).toEqual([
            connection("conn-1", "N0", "N1"),
        ])
    })

    it("drops connections whose target node no longer exists", () => {
        const nodes = [node("N0", 0)]
        const connections = [connection("conn-1", "N0", "N1")]

        expect(pruneDanglingConnections(connections, nodes)).toEqual([])
    })

    it("returns an empty array when there are no connections", () => {
        expect(pruneDanglingConnections([], [node("N0", 0)])).toEqual([])
    })
})
