import {FC, useCallback} from "react"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {Input} from "@agenta/primitive-ui/components/input"
import {Minus, Plus} from "@phosphor-icons/react"
import clsx from "clsx"

import styles from "../FormView.module.css"
import NodeHeader from "../shared/NodeHeader"
import TreeRow from "../shared/TreeRow"

import {BaseNodeProps} from "./NodeTypes"
import renderNode from "./renderNode"

interface ArrayNodeProps extends BaseNodeProps {
    value: unknown[]
}

const ArrayNodeComponent: FC<ArrayNodeProps> = (props) => {
    const {
        form,
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
            const currentRoot = structuredClone(
                form.getFieldsValue(true) as Record<string, unknown>,
            )
            const arrTarget = path.reduce<unknown>(
                (acc, key) => (acc as Record<string, unknown>)[key],
                currentRoot,
            ) as unknown[]
            if (!Array.isArray(arrTarget)) return

            arrTarget.splice(idx, 1)

            onChange(path, arrTarget)
        },
        [form, path, value, onChange],
    )

    const addItemWithTypeAt = useCallback(
        (index: number, type: "primitive" | "object" | "array") => {
            const currentRoot = structuredClone(
                form.getFieldsValue(true) as Record<string, unknown>,
            )
            const arrTarget = path.reduce<unknown>(
                (acc, key) => (acc as Record<string, unknown>)[key],
                currentRoot,
            ) as unknown[]
            if (!Array.isArray(arrTarget)) return
            const newItem = type === "object" ? {} : type === "array" ? [] : ""
            arrTarget.splice(index, 0, newItem)
            onChange(path, arrTarget)
        },
        [form, path, onChange],
    )

    const addItemWithType = (type: "primitive" | "object" | "array") =>
        addItemWithTypeAt(value.length, type)

    const AddMenuContent = ({index}: {index: number}) => (
        <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => addItemWithTypeAt(index, "primitive")}>
                Primitive
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => addItemWithTypeAt(index, "object")}>
                Object {"{ }"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => addItemWithTypeAt(index, "array")}>
                Array [ ]
            </DropdownMenuItem>
        </DropdownMenuContent>
    )

    const AddToEndMenuContent = () => (
        <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => addItemWithType("primitive")}>
                Primitive
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => addItemWithType("object")}>
                Object {"{ }"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => addItemWithType("array")}>Array [ ]</DropdownMenuItem>
        </DropdownMenuContent>
    )

    return (
        <div className={clsx("array-node")}>
            <NodeHeader
                depth={1}
                folded={collapsed.has(pathKey)}
                onToggle={() => toggleFold(pathKey)}
                className={clsx("array-key")}
            >
                <Input
                    defaultValue={k as string}
                    className="w-32 text-xs font-semibold p-0 border-0 bg-transparent shadow-none"
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
                                <DropdownMenu>
                                    <DropdownMenuTrigger className="bg-transparent border-none p-0 cursor-pointer inline-flex items-center text-inherit">
                                        <Plus size={14} />
                                    </DropdownMenuTrigger>
                                    <AddMenuContent index={0} />
                                </DropdownMenu>
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
                                        <DropdownMenu>
                                            <DropdownMenuTrigger className="bg-transparent border-none p-0 cursor-pointer inline-flex items-center text-inherit">
                                                <Plus size={14} />
                                            </DropdownMenuTrigger>
                                            <AddMenuContent index={idx} />
                                        </DropdownMenu>
                                    </div>
                                </div>
                            )}

                            <div className={styles["on-hover"]}>
                                <div className={styles["add-between"]}>
                                    <Minus size={14} onClick={() => removeItem(idx)} />
                                </div>
                            </div>

                            <TreeRow depth={2} className={clsx("array-item-wrapper flex", "ml-2")}>
                                {renderNode({
                                    form,
                                    path: [...path, idx],
                                    k: idx,
                                    value: item,
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
                    {value.length > 0 && (
                        <TreeRow depth={1} className={clsx("no-line flex", "ml-2")}>
                            <div className={clsx(styles["between-hover"])}>
                                <div className={styles["add-between"]}>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger className="bg-transparent border-none p-0 cursor-pointer inline-flex items-center text-inherit">
                                            <Plus size={14} />
                                        </DropdownMenuTrigger>
                                        <AddToEndMenuContent />
                                    </DropdownMenu>
                                </div>
                            </div>
                        </TreeRow>
                    )}

                    {value.length === 0 && (
                        <TreeRow depth={1} className={clsx("no-line flex", "ml-2")}>
                            <div className={clsx(styles["between-hover"])}>
                                <div className={styles["add-between"]}>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger className="bg-transparent border-none p-0 cursor-pointer inline-flex items-center text-inherit">
                                            <Plus size={14} />
                                        </DropdownMenuTrigger>
                                        <AddMenuContent index={0} />
                                    </DropdownMenu>
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
