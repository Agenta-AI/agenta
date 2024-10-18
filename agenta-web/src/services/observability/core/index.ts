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
    const buildData = (node: AgentaNodeDTO) => {
        const key = node.node.id
        const hasChildren = node.nodes && Object.keys(node.nodes).length > 0

        return {
            ...node,
            key,
            ...(hasChildren ? {children: observabilityTransformer(node)} : undefined),
        }
    }

    if (item.nodes) {
        return Object.entries(item.nodes)
            .flatMap(([_, value]) => {
                if (Array.isArray(value)) {
                    return value.map((item, index) =>
                        buildData({
                            ...item,
                            node: {...item.node, name: `${item.node.name}[${index}]`},
                        }),
                    )
                } else {
                    return buildData(value)
                }
            })
            .filter((node): node is _AgentaRootsResponse => node !== null && node !== undefined)
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
