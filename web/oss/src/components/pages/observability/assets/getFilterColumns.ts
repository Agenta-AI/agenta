import {FILTER_COLUMNS} from "./constants"
import {FilterGroup, FilterLeaf, FilterMenuNode} from "@/oss/components/Filters/Filters"

const cloneNodes = (nodes: FilterMenuNode[]): FilterMenuNode[] =>
    nodes.map((node) => {
        if (node.kind === "group") {
            const group = node as FilterGroup
            return {
                ...group,
                children: cloneNodes(group.children),
            }
        }
        return {...(node as FilterLeaf)}
    })

/** Single entry-point used by the UI */
const getFilterColumns = (): FilterMenuNode[] => cloneNodes(FILTER_COLUMNS)

export default getFilterColumns
