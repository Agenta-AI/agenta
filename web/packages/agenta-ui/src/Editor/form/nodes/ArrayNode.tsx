import {FC, type ReactNode, useCallback, useMemo} from "react"

import {Plus, Trash} from "@phosphor-icons/react"
import clsx from "clsx"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import {Input} from "../../../components/ui/input"
import styles from "../FormView.module.css"
import NodeHeader from "../shared/NodeHeader"
import TreeRow from "../shared/TreeRow"

import {BaseNodeProps} from "./NodeTypes"
import renderNode from "./renderNode"

interface ArrayNodeProps extends BaseNodeProps {
    value: unknown[]
}

interface AddItemMenuItem {
    key: string
    label: string
    onClick: () => void
}

const AddItemMenu: FC<{items: AddItemMenuItem[]; children: ReactNode}> = ({items, children}) => (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="start">
            {items.map((item) => (
                <DropdownMenuItem key={item.key} onSelect={item.onClick}>
                    {item.label}
                </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
    </DropdownMenu>
)

const addTrigger = (
    <button
        type="button"
        aria-label="Add item"
        className="box-border border-0 bg-transparent p-0 cursor-pointer text-colorText !mx-0"
    >
        <Plus size={14} />
    </button>
)

const ArrayNodeComponent: FC<ArrayNodeProps> = (props) => {
    const {
        path,
        k,
        value,

        collapsed,
        toggleFold,
        onChange,
        handleRename,
        customRender,
    } = props
    const pathKey = [...path].join(".")

    const removeItem = useCallback(
        (idx: number) => {
            const arrTarget = [...value]
            arrTarget.splice(idx, 1)

            onChange(path, arrTarget)
        },
        [path, value, onChange],
    )

    const addItemWithTypeAt = useCallback(
        (index: number, type: "primitive" | "object" | "array") => {
            const arrTarget = [...value]
            const newItem = type === "object" ? {} : type === "array" ? [] : ""
            arrTarget.splice(index, 0, newItem)
            onChange(path, arrTarget)
        },
        [path, value, onChange],
    )

    const addItemWithType = (type: "primitive" | "object" | "array") =>
        addItemWithTypeAt(value.length, type)

    const getMenuItems = useCallback(
        (index: number) => [
            {
                key: "primitive",
                label: "Primitive",
                onClick: () => addItemWithTypeAt(index, "primitive"),
            },
            {
                key: "object",
                label: "Object { }",
                onClick: () => addItemWithTypeAt(index, "object"),
            },
            {
                key: "array",
                label: "Array [ ]",
                onClick: () => addItemWithTypeAt(index, "array"),
            },
        ],
        [addItemWithTypeAt],
    )

    const addToEndMenuItems = useMemo(
        () => [
            {
                key: "primitive",
                label: "Primitive",
                onClick: () => addItemWithType("primitive"),
            },
            {
                key: "object",
                label: "Object { }",
                onClick: () => addItemWithType("object"),
            },
            {
                key: "array",
                label: "Array [ ]",
                onClick: () => addItemWithType("array"),
            },
        ],
        [addItemWithType],
    )

    return (
        <div className={clsx("array-node")}>
            <NodeHeader
                // depth={depth}
                depth={1}
                folded={collapsed.has(pathKey)}
                onToggle={() => toggleFold(pathKey)}
                className={clsx("array-key")}
            >
                <Input
                    defaultValue={k as string}
                    variant="ghost"
                    className="w-32 text-xs font-semibold p-0"
                    onBlur={(e) => {
                        const newKey = e.target.value.trim()
                        if (newKey && newKey !== k) {
                            handleRename(path, newKey)
                        }
                    }}
                />
            </NodeHeader>
            {!collapsed.has(pathKey) && (
                <>
                    <TreeRow depth={1} className={clsx("no-line flex", "ml-2")}>
                        <div className={clsx(styles["between-hover"])}>
                            <div className={styles["add-between"]}>
                                <AddItemMenu items={getMenuItems(0)}>{addTrigger}</AddItemMenu>
                            </div>
                        </div>
                    </TreeRow>

                    {value.map((item, idx) => (
                        <TreeRow
                            key={`array-child-${idx}`}
                            depth={1}
                            className={clsx("no-line flex", "ml-2")}
                        >
                            {idx >= 0 && (
                                <div className={clsx(styles["between-hover"])}>
                                    <div className={styles["add-between"]}>
                                        <AddItemMenu items={getMenuItems(idx)}>
                                            {addTrigger}
                                        </AddItemMenu>
                                    </div>
                                </div>
                            )}

                            <div className={styles["on-hover"]}>
                                <div className={styles["add-between"]}>
                                    <button
                                        type="button"
                                        aria-label="Remove item"
                                        className="box-border border-0 bg-transparent p-0 cursor-pointer text-colorText"
                                        onClick={() => removeItem(idx)}
                                    >
                                        <Trash size={14} />
                                    </button>
                                </div>
                            </div>

                            <TreeRow depth={2} className={clsx("array-item-wrapper flex", "ml-2")}>
                                {renderNode({
                                    path: [...path, idx],
                                    k: idx,
                                    value: item,
                                    // depth: depth + 1,
                                    depth: 3,
                                    collapsed,
                                    className: "array-item",
                                    toggleFold,
                                    onChange,
                                    handleRename,
                                    customRender,
                                })}
                            </TreeRow>
                        </TreeRow>
                    ))}
                    {/* Add to Bottom Button (disabled when empty) */}
                    {value.length > 0 && (
                        <TreeRow depth={1} className={clsx("no-line flex", "ml-2")}>
                            <div className={clsx(styles["between-hover"])}>
                                <div className={styles["add-between"]}>
                                    <AddItemMenu items={addToEndMenuItems}>
                                        {addTrigger}
                                    </AddItemMenu>
                                </div>
                            </div>
                        </TreeRow>
                    )}

                    {value.length === 0 && (
                        <TreeRow depth={1} className={clsx("no-line flex", "ml-2")}>
                            <div className={clsx(styles["between-hover"])}>
                                <div className={styles["add-between"]}>
                                    <AddItemMenu items={getMenuItems(0)}>{addTrigger}</AddItemMenu>
                                </div>
                            </div>
                        </TreeRow>
                    )}
                </>
            )}
        </div>
    )
}

export default ArrayNodeComponent
