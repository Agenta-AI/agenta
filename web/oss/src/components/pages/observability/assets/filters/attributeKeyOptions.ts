import {TraceSpanNode} from "@/oss/services/tracing/types"
import {SelectOption} from "@/oss/components/Filters/types"

export type AttributeKeyTreeOption = SelectOption & {
    children?: AttributeKeyTreeOption[]
    pathLabel: string
}

type MutableTreeNode = {
    children: Map<string, MutableTreeNode>
    selectable: boolean
}

const createNode = (): MutableTreeNode => ({children: new Map(), selectable: false})

const ensureChild = (parent: MutableTreeNode, key: string) => {
    let child = parent.children.get(key)
    if (!child) {
        child = createNode()
        parent.children.set(key, child)
    }
    return child
}

const addPath = (root: MutableTreeNode, path: string[]) => {
    if (!path.length) return
    let node = root
    path.forEach((segment) => {
        node = ensureChild(node, segment)
        node.selectable = true
    })
}

const traverseValue = (root: MutableTreeNode, value: unknown, path: string[]) => {
    if (value === undefined || value === null) return

    if (Array.isArray(value)) {
        if (path.length) addPath(root, path)
        value.forEach((item) => {
            if (item && typeof item === "object") traverseValue(root, item, path)
        })
        return
    }

    if (typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
        if (entries.length === 0) {
            if (path.length) addPath(root, path)
            return
        }
        entries.forEach(([key, child]) => {
            traverseValue(root, child, [...path, key])
        })
        return
    }

    if (path.length) addPath(root, path)
}

const collectFromSpan = (root: MutableTreeNode, span: TraceSpanNode) => {
    const agAttributes = (span.attributes as Record<string, unknown> | undefined)?.ag
    if (agAttributes && typeof agAttributes === "object") {
        traverseValue(root, agAttributes, ["ag"])
    }

    if (Array.isArray(span.children)) {
        span.children.forEach((child) => collectFromSpan(root, child as TraceSpanNode))
    }
}

const toOptions = (node: MutableTreeNode, prefix: string[]): AttributeKeyTreeOption[] => {
    const entries = Array.from(node.children.entries()).sort(([a], [b]) => a.localeCompare(b))
    return entries.map(([segment, child]) => {
        const path = [...prefix, segment]
        const children = toOptions(child, path)
        return {
            label: segment,
            value: `attributes.${path.join(".")}`,
            selectable: child.selectable,
            pathLabel: path.join("."),
            children: children.length ? children : undefined,
        }
    })
}

export const buildAttributeKeyTreeOptions = (
    traces: TraceSpanNode[] | undefined,
): AttributeKeyTreeOption[] => {
    if (!Array.isArray(traces) || traces.length === 0) return []
    const root = createNode()
    traces.forEach((trace) => collectFromSpan(root, trace))
    const agNode = root.children.get("ag")
    if (!agNode) return []
    return [
        {
            label: "ag",
            value: "attributes.ag",
            selectable: agNode.selectable,
            pathLabel: "ag",
            children: toOptions(agNode, ["ag"]),
        },
    ]
}
