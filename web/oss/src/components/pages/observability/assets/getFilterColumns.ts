import {FILTER_COLUMNS} from "./constants"
import {FilterGroup, FilterLeaf, FilterMenuNode} from "@/oss/components/Filters/types"
import {AttributeKeyTreeOption} from "./filters/attributeKeyOptions"

const cloneTreeOption = (option: AttributeKeyTreeOption): AttributeKeyTreeOption => ({
    ...option,
    children: option.children ? option.children.map(cloneTreeOption) : undefined,
})

const cloneTreeOptions = (
    options: AttributeKeyTreeOption[] | undefined,
): AttributeKeyTreeOption[] => (options ? options.map(cloneTreeOption) : [])

const findOptionByPath = (
    options: AttributeKeyTreeOption[] | undefined,
    segments: string[],
): AttributeKeyTreeOption | undefined => {
    if (!options || segments.length === 0) return undefined

    const [segment, ...rest] = segments
    const match = options.find((option) => option.label === segment)

    if (!match) return undefined
    if (rest.length === 0) return match

    return findOptionByPath(match.children, rest)
}

const selectTreeOptions = (
    options: AttributeKeyTreeOption[] | undefined,
    treePath?: string,
): AttributeKeyTreeOption[] => {
    if (!options || options.length === 0) return []
    if (!treePath) return cloneTreeOptions(options)

    const segments = treePath.split(".").filter(Boolean)
    const branch = findOptionByPath(options, segments)

    if (!branch) return []

    if (branch.children && branch.children.length > 0) {
        return cloneTreeOptions(branch.children)
    }

    return [cloneTreeOption(branch)]
}

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

const applyAttributeKeyOptions = (
    nodes: FilterMenuNode[],
    options: AttributeKeyTreeOption[] | undefined,
) => {
    if (!options || options.length === 0) return nodes

    nodes.forEach((node) => {
        if (node.kind === "group") {
            applyAttributeKeyOptions((node as FilterGroup).children, options)
            return
        }
        const leaf = node as FilterLeaf
        if (leaf.keyInput?.kind === "select" && leaf.keyInput.usesAttributeKeyTree) {
            const {treePath} = leaf.keyInput
            leaf.keyInput = {
                ...leaf.keyInput,
                options: selectTreeOptions(options, treePath),
            }
        }
    })
    return nodes
}

/** Single entry-point used by the UI */
const getFilterColumns = (attributeKeyOptions?: AttributeKeyTreeOption[]): FilterMenuNode[] =>
    applyAttributeKeyOptions(cloneNodes(FILTER_COLUMNS), attributeKeyOptions)

export default getFilterColumns
