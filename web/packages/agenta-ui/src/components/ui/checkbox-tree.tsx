import type {Key, ReactNode} from "react"
import {useCallback} from "react"

import {cn} from "../../utils/styles"

import {Checkbox} from "./checkbox"

/**
 * antd's checkable `Tree`, minus antd — the last antd import in this package.
 *
 * Scoped to what the column-visibility popover actually uses: a checkable, expandable tree
 * with a tri-state parent. Checking is fully controlled by the caller (it owns the
 * parent/child semantics), so this only reports which node was hit.
 */

export interface CheckboxTreeNode {
    key: Key
    title: ReactNode
    children?: CheckboxTreeNode[]
    icon?: ReactNode
}

export interface CheckboxTreeProps {
    treeData: CheckboxTreeNode[]
    checkedKeys: string[]
    /** Parents whose children are only partly checked. */
    halfCheckedKeys?: string[]
    expandedKeys: string[]
    onExpand: (keys: string[]) => void
    /** `hasChildren` saves callers re-deriving what they just rendered. */
    onCheck: (key: string, node: CheckboxTreeNode, hasChildren: boolean) => void
    /** Scrolls past this height, like antd's `height`. */
    height?: number
    className?: string
}

const Node = ({
    node,
    depth,
    checkedKeys,
    halfCheckedKeys,
    expandedKeys,
    onToggleExpand,
    onCheck,
}: {
    node: CheckboxTreeNode
    depth: number
    checkedKeys: string[]
    halfCheckedKeys: string[]
    expandedKeys: string[]
    onToggleExpand: (key: string) => void
    onCheck: CheckboxTreeProps["onCheck"]
}) => {
    const key = String(node.key)
    const children = node.children ?? []
    const hasChildren = children.length > 0
    const expanded = expandedKeys.includes(key)
    const checked = checkedKeys.includes(key)
    const halfChecked = halfCheckedKeys.includes(key)

    return (
        <li
            role="treeitem"
            aria-expanded={hasChildren ? expanded : undefined}
            className="list-none"
        >
            <div
                className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-colorFillTertiary"
                style={{paddingLeft: depth * 16 + 4}}
            >
                {hasChildren ? (
                    <button
                        type="button"
                        aria-label={expanded ? `Collapse ${key}` : `Expand ${key}`}
                        aria-expanded={expanded}
                        onClick={() => onToggleExpand(key)}
                        className="flex size-4 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-colorTextSecondary"
                    >
                        <span className={cn("transition-transform", expanded && "rotate-90")}>
                            ›
                        </span>
                    </button>
                ) : (
                    <span className="size-4 shrink-0" />
                )}

                <Checkbox
                    aria-label={`Toggle ${key}`}
                    checked={halfChecked && !checked ? "indeterminate" : checked}
                    onCheckedChange={() => onCheck(key, node, hasChildren)}
                />

                {node.icon ? <span className="shrink-0">{node.icon}</span> : null}
                <span className="min-w-0 flex-1 truncate text-field-md">{node.title}</span>
            </div>

            {hasChildren && expanded ? (
                <ul role="group" className="m-0 p-0">
                    {children.map((child) => (
                        <Node
                            key={String(child.key)}
                            node={child}
                            depth={depth + 1}
                            checkedKeys={checkedKeys}
                            halfCheckedKeys={halfCheckedKeys}
                            expandedKeys={expandedKeys}
                            onToggleExpand={onToggleExpand}
                            onCheck={onCheck}
                        />
                    ))}
                </ul>
            ) : null}
        </li>
    )
}

export function CheckboxTree({
    treeData,
    checkedKeys,
    halfCheckedKeys = [],
    expandedKeys,
    onExpand,
    onCheck,
    height,
    className,
}: CheckboxTreeProps) {
    const handleToggleExpand = useCallback(
        (key: string) =>
            onExpand(
                expandedKeys.includes(key)
                    ? expandedKeys.filter((k) => k !== key)
                    : [...expandedKeys, key],
            ),
        [expandedKeys, onExpand],
    )

    return (
        <ul
            role="tree"
            className={cn("m-0 overflow-auto p-0", className)}
            style={height ? {maxHeight: height} : undefined}
        >
            {treeData.map((node) => (
                <Node
                    key={String(node.key)}
                    node={node}
                    depth={0}
                    checkedKeys={checkedKeys}
                    halfCheckedKeys={halfCheckedKeys}
                    expandedKeys={expandedKeys}
                    onToggleExpand={handleToggleExpand}
                    onCheck={onCheck}
                />
            ))}
        </ul>
    )
}

export default CheckboxTree
