import {type FC, Fragment, useCallback} from "react"

import {PlusOutlined, DeleteOutlined} from "@ant-design/icons"
import {Typography} from "antd"
import {Dropdown} from "antd"
import clsx from "clsx"

import styles from "../FormView.module.css"
import NodeHeader from "../shared/NodeHeader"
import TreeRow from "../shared/TreeRow"

import {BaseNodeProps} from "./NodeTypes"
import renderNode from "./renderNode"

interface ObjectNodeProps extends BaseNodeProps {
    value: Record<string, unknown>
}

const {Text} = Typography

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
                (acc: any, key) => (acc ? acc[key] : undefined),
                currentRoot,
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
                (acc: any, key) => (acc ? acc[key] : undefined),
                currentRoot,
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
                (acc: any, key) => (acc ? acc[key] : undefined),
                currentRoot,
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
                    .reduce<Record<string, unknown>>((acc: any, key) => acc[key], currentRoot)
                parent[path[path.length - 1]] = newObj
            }
            // simpler set by path: assign
            path.reduce((acc: any, key, idx, arr) => {
                if (idx === arr.length - 1) {
                    acc[key] = newObj
                }
                return acc[key]
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
                        <Dropdown
                            menu={{
                                items: [
                                    {
                                        key: "primitive",
                                        label: "Primitive",
                                        onClick: () => addKeyWithType("primitive"),
                                    },
                                    {
                                        key: "object",
                                        label: "Object { }",
                                        onClick: () => addKeyWithType("object"),
                                    },
                                    {
                                        key: "array",
                                        label: "Array [ ]",
                                        onClick: () => addKeyWithType("array"),
                                    },
                                ],
                            }}
                            trigger={["click"]}
                        >
                            <PlusOutlined className={styles["add-inline-btn"]} />
                        </Dropdown>
                    </div>

                    <Text
                        className="text-xs font-semibold leading-5 mr-1"
                        editable={{
                            icon: null,
                            triggerType: ["text"],
                            onChange: (newKey) => {
                                const trimmed = newKey.trim()
                                if (trimmed && trimmed !== k) {
                                    handleRename(path, trimmed)
                                }
                            },
                        }}
                    >
                        {k}
                    </Text>
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
                                            <PlusOutlined
                                                className="!mx-0"
                                                onClick={() => insertKeyBefore(childKey)}
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className={styles["on-hover"]}>
                                    <div className={styles["add-between"]}>
                                        <DeleteOutlined
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
