import React, {useState} from "react"

import {MinusSquareOutlined, PlusSquareOutlined} from "@ant-design/icons"

import {_AgentaRootsResponse} from "@/oss/services/observability/types"

import {TreeContent} from "../../pages/observability/drawer/TraceTree"

import {useStyles} from "./assets/styles"
import {TraceSpanNode} from "@/oss/services/tracing/types"

/**
 * CustomTree is a recursive tree view component for rendering a hierarchy of nodes.
 *
 * This component is highly customizable and highlights the selected node.
 * It supports displaying additional metrics like latency, cost, and token usage.
 *
 * Example usage:
 * ```tsx
 * <CustomTree
 *   data={rootNode}
 *   settings={{ latency: true, cost: false, tokens: true }}
 *   selectedKey={selectedNodeId}
 *   onSelect={(key) => setSelectedNodeId(key)}
 * />
 * ```
 */
interface TreeProps {
    /**
     * Root node of the hierarchical data structure.
     */
    data: TraceSpanNode

    /**
     * Settings for what additional metrics to show in each node.
     */
    settings: {
        latency: boolean
        cost: boolean
        tokens: boolean
    }

    /**
     * The currently selected node key (ID).
     */
    selectedKey: string | null

    /**
     * Function to handle when a node is selected.
     */
    onSelect: (key: string) => void
}

const TreeNodeComponent: React.FC<{
    node: TraceSpanNode
    isLast: boolean
    settings: {latency: boolean; cost: boolean; tokens: boolean}
    selectedKey: string | null
    onSelect: (key: string) => void
    isRoot?: boolean
}> = ({node, isLast, settings, selectedKey, onSelect, isRoot = false}) => {
    const classes = useStyles()
    const [expanded, setExpanded] = useState(true)
    const hasChildren = node.children && node.children.length > 0

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
                    onClick={() => onSelect(node.span_id)}
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
                            (node.span_id === selectedKey ? "bg-[#F5F7FA]" : "")
                        }
                    >
                        <TreeContent value={node} settings={settings} />
                    </div>
                </div>
            </div>

            {hasChildren && expanded && (
                <div>
                    {node.children!.map((child, index) => (
                        <TreeNodeComponent
                            key={index}
                            node={child}
                            isLast={index === node.children!.length - 1}
                            settings={settings}
                            selectedKey={selectedKey}
                            onSelect={onSelect}
                            isRoot={false}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

const CustomTree: React.FC<TreeProps> = ({data, settings, selectedKey, onSelect}) => {
    return (
        <div className={"h-full overflow-y-auto p-2"}>
            <TreeNodeComponent
                node={data}
                isLast={false}
                settings={settings}
                selectedKey={selectedKey}
                onSelect={onSelect}
                isRoot={true}
            />
        </div>
    )
}

export default CustomTree
