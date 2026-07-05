import {type FC, Fragment, useCallback} from "react"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {Minus, Plus} from "@phosphor-icons/react"
import clsx from "clsx"

import {EditableText} from "../../../components/presentational/editable/EditableText"
import styles from "../FormView.module.css"
import NodeHeader from "../shared/NodeHeader"
import TreeRow from "../shared/TreeRow"

import {BaseNodeProps} from "./NodeTypes"
import renderNode from "./renderNode"

interface ObjectNodeProps extends BaseNodeProps {
    value: Record<string, unknown>
}

const ObjectNodeComponent: FC<ObjectNodeProps> = (props) => {
    const {
        customRender,
        form,
        path,
        k,
        value,
        depth,
        collapsed,
        toggleFold,
        onChange,
        handleRename,
    } = props
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
            const currentRoot = form.getFieldsValue(true) as Record<string, unknown>
            const objTarget = path.reduce<Record<string, unknown> | undefined>(
                (acc, key) => (acc ? (acc[key] as Record<string, unknown> | undefined) : undefined),
                currentRoot as Record<string, unknown> | undefined,
            )
            if (!objTarget || typeof objTarget !== "object") return
            const newKey = genUniqueKey(objTarget)
            objTarget[newKey] = type === "object" ? {} : type === "array" ? [] : ""
            form.setFieldsValue(currentRoot)
            onChange(path, objTarget)
        },
        [form, path, onChange],
    )

    const addKey = useCallback(() => {
        addKeyWithType("primitive")
    }, [addKeyWithType])

    const removeKey = useCallback(
        (keyToRemove: string) => {
            const currentRoot = form.getFieldsValue(true) as Record<string, unknown>
            const objTarget = path.reduce<Record<string, unknown> | undefined>(
                (acc, key) => (acc ? (acc[key] as Record<string, unknown> | undefined) : undefined),
                currentRoot as Record<string, unknown> | undefined,
            )
            if (!objTarget || typeof objTarget !== "object") return
            delete objTarget[keyToRemove]
            form.setFieldsValue(currentRoot)
            onChange(path, objTarget)
        },
        [form, path, onChange],
    )

    const insertKeyBefore = useCallback(
        (before: string) => {
            const currentRoot = form.getFieldsValue(true) as Record<string, unknown>
            const objTarget = path.reduce<Record<string, unknown> | undefined>(
                (acc, key) => (acc ? (acc[key] as Record<string, unknown> | undefined) : undefined),
                currentRoot as Record<string, unknown> | undefined,
            )
            if (!objTarget || typeof objTarget !== "object") return
            const entries = Object.entries(objTarget)
            const idx = entries.findIndex(([key]) => key === before)
            if (idx === -1) {
                addKey()
                return
            }
            const newKey = genUniqueKey(objTarget)
            const newObj: Record<string, unknown> = {}
            entries.forEach(([key, val], i) => {
                if (i === idx) {
                    newObj[newKey] = ""
                }
                newObj[key] = val
            })
            // replace whole object at path
            if (path.length === 0) {
                Object.assign(currentRoot, newObj)
            } else {
                const parent = path
                    .slice(0, -1)
                    .reduce<
                        Record<string, unknown>
                    >((acc, key) => acc[key] as Record<string, unknown>, currentRoot)
                parent[path[path.length - 1]] = newObj
            }
            // simpler set by path: assign
            path.reduce<Record<string, unknown>>((acc, key, idx, arr) => {
                if (idx === arr.length - 1) {
                    acc[key] = newObj
                }
                return acc[key] as Record<string, unknown>
            }, currentRoot)
            form.setFieldsValue(currentRoot)
            onChange(path, newObj)
        },
        [form, path, onChange],
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
                            <DropdownMenuTrigger className="bg-transparent border-none p-0 cursor-pointer inline-flex items-center text-inherit">
                                <Plus size={14} />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                <DropdownMenuItem onClick={() => addKeyWithType("primitive")}>
                                    Primitive
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => addKeyWithType("object")}>
                                    Object {"{ }"}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => addKeyWithType("array")}>
                                    Array [ ]
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    <EditableText
                        value={String(k)}
                        monospace={false}
                        tooltip="Click to rename"
                        className="text-xs font-semibold leading-5 mr-1"
                        onChange={(newKey) => {
                            const trimmed = newKey.trim()
                            if (trimmed && trimmed !== k) {
                                handleRename(path, trimmed)
                            }
                        }}
                    />
                </NodeHeader>
            </div>
            {!collapsed.has(pathKey) &&
                Object.entries(value).map(([childKey, childVal], idx, arr) => (
                    <Fragment key={childKey}>
                        <div className={styles["row-wrapper"]} style={{position: "relative"}}>
                            {/* <DeleteOutlined className={styles['add-inline']} onClick={() => removeKey(childKey as string)} /> */}
                            <TreeRow depth={1} className={clsx("object-item-wrapper flex")}>
                                {renderNode({
                                    form,
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
                                            <Plus
                                                size={14}
                                                className="!mx-0 cursor-pointer"
                                                onClick={() => insertKeyBefore(childKey)}
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className={styles["on-hover"]}>
                                    <div className={styles["add-between"]}>
                                        <Minus
                                            size={14}
                                            className="cursor-pointer"
                                            onClick={() => removeKey(childKey as string)}
                                        />
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
