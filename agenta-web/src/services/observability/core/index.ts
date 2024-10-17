import {delay} from "@/lib/helpers/utils"
import data from "@/lib/test_trace.json"
import {_AgentaRootsResponse, AgentaNodeDTO, AgentaTreeDTO} from "../types"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const observabilityTransformer = (
    item: AgentaTreeDTO | AgentaNodeDTO,
): _AgentaRootsResponse[] => {
    if (item.nodes) {
        return Object.entries(item.nodes)
            .flatMap(([_, value]) => {
                if (value && Array.isArray(value)) {
                    return value.flatMap((item) => observabilityTransformer(item))
                }

                if (value && !Array.isArray(value)) {
                    const {nodes, ...node} = value
                    return {
                        ...node,
                        key: node.node.id,
                        ...(value.nodes ? {children: observabilityTransformer(value)} : null),
                    }
                }
            })
            .filter((item): item is _AgentaRootsResponse => item !== null && item !== undefined)
    }

    return []
}

export const fetchAllTraces = async () => {
    await delay(1000)
    return data.roots.flatMap((item) =>
        // @ts-ignore
        observabilityTransformer(item.trees[0]),
    ) as _AgentaRootsResponse[]
}
