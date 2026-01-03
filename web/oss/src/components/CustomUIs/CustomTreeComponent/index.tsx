import React, {useMemo, useState} from "react"

import {MinusSquareOutlined, PlusSquareOutlined} from "@ant-design/icons"

import {useStyles} from "./assets/styles"

/**
 * CustomTree is a recursive tree view component for rendering a hierarchy of nodes.
 *
 * This component is highly customizable and highlights the selected node.
 * It supports custom node rendering and optional default expansion.
 *
 * Example usage:
 * ```tsx
 * <CustomTree
 *   data={rootNode}
 *   getKey={(node) => node.id}
 *   getChildren={(node) => node.children}
 *   renderLabel={(node) => node.title}
 *   selectedKey={selectedNodeId}
 *   onSelect={(key, node) => setSelectedNodeId(key)}
 * />
 * ```
 */
interface TreeProps<TNode> {
    /**
     * Root node of the hierarchical data structure.
     */
    data: TNode

    /**
     * Returns a stable key for a node.
     */
    getKey: (node: TNode) => string

    /**
     * Returns child nodes for a node.
     */
    getChildren: (node: TNode) => TNode[] | undefined

    /**
     * Render the label content for a node.
     */
    renderLabel: (node: TNode) => React.ReactNode

    /**
     * The currently selected node key (ID).
     */
    selectedKey?: string | null

    /**
     * Function to handle when a node is selected.
     */
    onSelect?: (key: string, node: TNode) => void

    /**
     * Default expansion state for nodes without explicit `expanded` metadata.
     */
    defaultExpanded?: boolean
}

const TreeNodeComponent = <TNode,>({
    node,
    isLast,
    getKey,
    getChildren,
    renderLabel,
    selectedKey,
    onSelect,
    defaultExpanded = true,
    isRoot = false,
}: {
    node: TNode
    isLast: boolean
    getKey: (node: TNode) => string
    getChildren: (node: TNode) => TNode[] | undefined
    renderLabel: (node: TNode) => React.ReactNode
    selectedKey?: string | null
    onSelect?: (key: string, node: TNode) => void
    defaultExpanded?: boolean
    isRoot?: boolean
}) => {
    const classes = useStyles()
    const initialExpanded = useMemo(() => {
        if (typeof (node as {expanded?: boolean}).expanded === "boolean") {
            return (node as {expanded?: boolean}).expanded as boolean
        }
        return defaultExpanded
    }, [defaultExpanded, node])
    const [expanded, setExpanded] = useState(initialExpanded)
    const children = getChildren(node) ?? []
    const hasChildren = children.length > 0
    const nodeKey = getKey(node)

    const toggle = () => setExpanded((prev) => !prev)

    // Determines whether to render a "last" connector line (for styling)
    const shouldShowAsLast = isLast && (!hasChildren || (hasChildren && !expanded))

    return (
        <div className={isRoot ? "pl-2" : "relative pl-5"}>
            <div
                className={
                    !isRoot ? `${classes.treeLine} ${shouldShowAsLast ? "last" : ""}` : undefined
                }
            >
                <div
                    className={
                        !isRoot
                            ? `${classes.nodeLabel} ${shouldShowAsLast ? "last" : ""}`
                            : "flex items-center"
                    }
                    onClick={() => onSelect?.(nodeKey, node)}
                >
                    {hasChildren && (
                        <span
                            className={"mr-2 cursor-pointer"}
                            onClick={(e) => {
                                e.stopPropagation()
                                toggle()
                            }}
                        >
                            {expanded ? <MinusSquareOutlined /> : <PlusSquareOutlined />}
                        </span>
                    )}
                    <div
                        className={
                            classes.nodeLabelContent +
                            " " +
                            (nodeKey === selectedKey ? "bg-[#F5F7FA]" : "")
                        }
                    >
                        {renderLabel(node)}
                    </div>
                </div>
            </div>

            {hasChildren && expanded && (
                <div>
                    {children.map((child, index) => (
                        <TreeNodeComponent
                            key={getKey(child)}
                            node={child}
                            isLast={index === children.length - 1}
                            getKey={getKey}
                            getChildren={getChildren}
                            renderLabel={renderLabel}
                            selectedKey={selectedKey}
                            onSelect={onSelect}
                            defaultExpanded={defaultExpanded}
                            isRoot={false}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

const CustomTree = <TNode,>({
    data,
    getKey,
    getChildren,
    renderLabel,
    selectedKey,
    onSelect,
    defaultExpanded,
}: TreeProps<TNode>) => {
    return (
        <div className={"h-full overflow-y-auto p-2"}>
            <TreeNodeComponent
                node={data}
                isLast={false}
                getKey={getKey}
                getChildren={getChildren}
                renderLabel={renderLabel}
                selectedKey={selectedKey}
                onSelect={onSelect}
                defaultExpanded={defaultExpanded}
                isRoot={true}
            />
        </div>
    )
}

export default CustomTree
