import {FC, useCallback, useMemo} from "react"

import {PlusOutlined, DeleteOutlined} from "@ant-design/icons"
import {Input} from "antd"
import {Dropdown} from "antd"
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
            const arrTarget = path.reduce((acc: any, key) => acc[key], currentRoot) as unknown[]
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
            const arrTarget = path.reduce((acc: any, key) => acc[key], currentRoot) as unknown[]
            if (!Array.isArray(arrTarget)) return
            const newItem = type === "object" ? {} : type === "array" ? [] : ""
            arrTarget.splice(index, 0, newItem)
            onChange(path, arrTarget)
        },
        [form, path, onChange],
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
                    variant="borderless"
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
                                <Dropdown menu={{items: getMenuItems(0)}} trigger={["click"]}>
                                    <PlusOutlined className="!mx-0" />
                                </Dropdown>
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
                                        <Dropdown
                                            menu={{items: getMenuItems(idx)}}
                                            trigger={["click"]}
                                        >
                                            <PlusOutlined className="!mx-0" />
                                        </Dropdown>
                                    </div>
                                </div>
                            )}

                            <div className={styles["on-hover"]}>
                                <div className={styles["add-between"]}>
                                    <DeleteOutlined onClick={() => removeItem(idx)} />
                                </div>
                            </div>

                            <TreeRow depth={2} className={clsx("array-item-wrapper flex", "ml-2")}>
                                {renderNode({
                                    form,
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
                                    <Dropdown menu={{items: addToEndMenuItems}} trigger={["click"]}>
                                        <PlusOutlined className="!mx-0" />
                                    </Dropdown>
                                </div>
                            </div>
                        </TreeRow>
                    )}

                    {value.length === 0 && (
                        <TreeRow depth={1} className={clsx("no-line flex", "ml-2")}>
                            <div className={clsx(styles["between-hover"])}>
                                <div className={styles["add-between"]}>
                                    <Dropdown menu={{items: getMenuItems(0)}} trigger={["click"]}>
                                        <PlusOutlined className="!mx-0" />
                                    </Dropdown>
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
