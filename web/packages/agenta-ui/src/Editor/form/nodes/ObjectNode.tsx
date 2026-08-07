import {type FC, Fragment, useCallback} from "react"

import {Plus, Trash} from "@phosphor-icons/react"
import clsx from "clsx"

import EditableText from "../../../components/presentational/editable/EditableText"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import styles from "../FormView.module.css"
import NodeHeader from "../shared/NodeHeader"
import TreeRow from "../shared/TreeRow"

import {BaseNodeProps} from "./NodeTypes"
import renderNode from "./renderNode"

interface ObjectNodeProps extends BaseNodeProps {
    value: Record<string, unknown>
}

const ObjectNodeComponent: FC<ObjectNodeProps> = (props) => {
    const {customRender, path, k, value, depth, collapsed, toggleFold, onChange, handleRename} =
        props
    const pathKey = path.join(".")

    const genUniqueKey = (obj: Record<string, unknown>): string => {
        let base = "newKey"
        let candidate = base
        let counter = 1
        while (Object.prototype.hasOwnProperty.call(obj, candidate)) {
            candidate = `${base}${counter++}`
        }
        return candidate
    }
    const addKeyWithType = useCallback(
        (type: "primitive" | "object" | "array") => {
            const objTarget = {...value}
            const newKey = genUniqueKey(objTarget)
            objTarget[newKey] = type === "object" ? {} : type === "array" ? [] : ""
            onChange(path, objTarget)
        },
        [value, path, onChange],
    )

    const addKey = useCallback(() => {
        addKeyWithType("primitive")
    }, [addKeyWithType])

    const removeKey = useCallback(
        (keyToRemove: string) => {
            const objTarget = {...value}
            delete objTarget[keyToRemove]
            onChange(path, objTarget)
        },
        [value, path, onChange],
    )

    const insertKeyBefore = useCallback(
        (before: string) => {
            const entries = Object.entries(value)
            const idx = entries.findIndex(([key]) => key === before)
            if (idx === -1) {
                addKey()
                return
            }
            const newKey = genUniqueKey(value)
            const newObj: Record<string, unknown> = {}
            entries.forEach(([key, val], i) => {
                if (i === idx) {
                    newObj[newKey] = ""
                }
                newObj[key] = val
            })
            onChange(path, newObj)
        },
        [value, path, onChange, addKey],
    )

    const handleRenameKey = useCallback(
        (newKey: string) => {
            const trimmed = newKey.trim()
            if (trimmed && trimmed !== k) {
                handleRename(path, trimmed)
            }
        },
        [handleRename, path, k],
    )

    return (
        <div className={clsx("object-node")}>
            <div className={styles["row-wrapper"]} style={{position: "relative"}}>
                <NodeHeader
                    depth={1}
                    folded={collapsed.has(pathKey)}
                    onToggle={() => toggleFold(pathKey)}
                    className={clsx("object-key")}
                >
                    <div className={clsx(styles["add-inline-btn"])}>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    aria-label="Add key"
                                    className={clsx(
                                        styles["add-inline-btn"],
                                        "box-border border-0 bg-transparent p-0 cursor-pointer text-colorText",
                                    )}
                                >
                                    <Plus size={14} />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                <DropdownMenuItem onSelect={() => addKeyWithType("primitive")}>
                                    Primitive
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => addKeyWithType("object")}>
                                    Object {"{ }"}
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => addKeyWithType("array")}>
                                    Array [ ]
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    <EditableText
                        value={String(k)}
                        onChange={handleRenameKey}
                        monospace={false}
                        className="font-semibold leading-5 mr-1"
                    />
                </NodeHeader>
            </div>
            {!collapsed.has(pathKey) &&
                Object.entries(value).map(([childKey, childVal], idx, arr) => (
                    <Fragment key={childKey}>
                        <div className={styles["row-wrapper"]} style={{position: "relative"}}>
                            <TreeRow depth={1} className={clsx("object-item-wrapper flex")}>
                                {renderNode({
                                    path: [...path, childKey],
                                    k: childKey,
                                    value: childVal,
                                    depth: depth + 1,
                                    collapsed,
                                    toggleFold,
                                    onChange,
                                    handleRename,
                                    customRender,
                                })}
                                {idx >= 0 && (
                                    <div className={clsx(styles["between-hover"])}>
                                        <div className={styles["add-between"]}>
                                            <button
                                                type="button"
                                                aria-label="Insert key before"
                                                className="box-border border-0 bg-transparent p-0 cursor-pointer text-colorText !mx-0"
                                                onClick={() => insertKeyBefore(childKey)}
                                            >
                                                <Plus size={14} />
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className={styles["on-hover"]}>
                                    <div className={styles["add-between"]}>
                                        <button
                                            type="button"
                                            aria-label="Remove key"
                                            className="box-border border-0 bg-transparent p-0 cursor-pointer text-colorText"
                                            onClick={() => removeKey(childKey as string)}
                                        >
                                            <Trash size={14} />
                                        </button>
                                    </div>
                                </div>
                            </TreeRow>
                        </div>
                    </Fragment>
                ))}
        </div>
    )
}

export default ObjectNodeComponent
