import React, {useMemo, useState} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {CollapseCaret, cn} from "@agenta/ui/ui"
import {MinusSquare, PlusSquare} from "@phosphor-icons/react"

import {nodeLabelClass, nodeLabelContentClass, treeLineClass} from "./customTreeStyles"

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

    /**
     * One 28px line per node, indented 16px per level, with a caret and no connector lines
     * (the trace drawer's tree).
     */
    compact?: boolean
}

/** A compact node: one line, the caret in a fixed slot so labels line up. */
const CompactNode = <TNode,>({
    node,
    depth,
    getKey,
    getChildren,
    renderLabel,
    selectedKey,
    onSelect,
    defaultExpanded = true,
}: {
    node: TNode
    depth: number
    getKey: (node: TNode) => string
    getChildren: (node: TNode) => TNode[] | undefined
    renderLabel: (node: TNode) => React.ReactNode
    selectedKey?: string | null
    onSelect?: (key: string, node: TNode) => void
    defaultExpanded?: boolean
}) => {
    const t = useT(commonCatalog)
    const [expanded, setExpanded] = useState(defaultExpanded)
    const children = getChildren(node) ?? []
    const nodeKey = getKey(node)
    return (
        <>
            <div
                role="treeitem"
                aria-selected={nodeKey === selectedKey}
                aria-expanded={children.length > 0 ? expanded : undefined}
                className={cn(
                    "flex h-7 min-w-0 cursor-pointer items-center gap-1 rounded-control pr-2 hover:bg-accent",
                    nodeKey === selectedKey && "bg-selected hover:bg-selected",
                )}
                style={{paddingLeft: depth * 16 + 4}}
                onClick={() => onSelect?.(nodeKey, node)}
            >
                {children.length > 0 ? (
                    <button
                        type="button"
                        aria-label={expanded ? t("common.collapse") : t("common.expand")}
                        className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0"
                        onClick={(event) => {
                            event.stopPropagation()
                            setExpanded((prev) => !prev)
                        }}
                    >
                        <CollapseCaret open={expanded} />
                    </button>
                ) : (
                    <span aria-hidden className="size-4 shrink-0" />
                )}
                <div className="min-w-0 flex-1">{renderLabel(node)}</div>
            </div>
            {expanded
                ? children.map((child) => (
                      <CompactNode
                          key={getKey(child)}
                          node={child}
                          depth={depth + 1}
                          getKey={getKey}
                          getChildren={getChildren}
                          renderLabel={renderLabel}
                          selectedKey={selectedKey}
                          onSelect={onSelect}
                          defaultExpanded={defaultExpanded}
                      />
                  ))
                : null}
        </>
    )
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
                    !isRoot ? `${treeLineClass} ${shouldShowAsLast ? "last" : ""}` : undefined
                }
            >
                <div
                    className={
                        !isRoot
                            ? `${nodeLabelClass} ${shouldShowAsLast ? "last" : ""}`
                            : "flex items-center"
                    }
                    onClick={() => onSelect?.(nodeKey, node)}
                >
                    {hasChildren && (
                        <span
                            className="mr-2 inline-flex shrink-0 cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation()
                                toggle()
                            }}
                        >
                            {expanded ? <MinusSquare size={14} /> : <PlusSquare size={14} />}
                        </span>
                    )}
                    <div
                        className={
                            nodeLabelContentClass +
                            " " +
                            (nodeKey === selectedKey ? "bg-muted" : "")
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
    compact = false,
}: TreeProps<TNode>) => {
    if (compact) {
        return (
            <div role="tree" className="p-2">
                <CompactNode
                    node={data}
                    depth={0}
                    getKey={getKey}
                    getChildren={getChildren}
                    renderLabel={renderLabel}
                    selectedKey={selectedKey}
                    onSelect={onSelect}
                    defaultExpanded={defaultExpanded}
                />
            </div>
        )
    }
    return (
        <div className={"overflow-y-auto p-2"}>
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
