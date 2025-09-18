import {FC, Fragment, useState, useEffect, useCallback} from "react"

import {Form} from "antd"
import merge from "lodash/merge"

import styles from "./FormView.module.css"
import {CustomRenderFn} from "./nodes/NodeTypes"
import renderNode from "./nodes/renderNode"
export interface FormViewProps {
    value: Record<string, unknown>
    onChange: (v: Record<string, unknown>) => void
    customRender?: CustomRenderFn
}

const isPlainObject = (obj: unknown): obj is Record<string, unknown> =>
    typeof obj === "object" && obj !== null && !Array.isArray(obj)

const prepareInitialValues = (obj: unknown): unknown => {
    if (Array.isArray(obj)) {
        return obj.map((item) => prepareInitialValues(item))
    }
    if (isPlainObject(obj)) {
        const out: Record<string, unknown> = {}
        Object.entries(obj).forEach(([k, v]) => {
            if (isPlainObject(v)) {
                out[k] = prepareInitialValues(v) // keep objects nested
            } else if (Array.isArray(v)) {
                out[k] = v.map((item) => prepareInitialValues(item))
            } else {
                out[k] = v
            }
        })
        return out
    }
    return obj
}

// Deep-clone helper using structuredClone when available
const deepClone = <T,>(obj: T): T =>
    typeof structuredClone === "function" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj))

// Rename a key in a nested object based on path
const renameKey = (
    root: Record<string, unknown>,
    path: (string | number)[],
    newKey: string,
): Record<string, unknown> => {
    if (path.length === 0) return root
    const cloned = deepClone(root)
    let cursor: any = cloned
    for (let i = 0; i < path.length - 1; i++) {
        const seg = path[i]
        cursor = cursor[seg]
        if (cursor === undefined) return cloned // path invalid
    }
    const last = path[path.length - 1] as string
    if (typeof last !== "string") return cloned // arrays not renamable
    const prevKeys = Object.keys(cursor)
    const reordered: Record<string, unknown> = {}
    Object.entries(cursor).forEach(([key, val]) => {
        if (key === last) {
            reordered[newKey] = val
        } else {
            reordered[key] = val
        }
    })
    // replace object with reordered keys
    Object.keys(cursor).forEach((k) => delete cursor[k])
    Object.assign(cursor, reordered)
    return cloned
}

// handleRename will be defined inside component to access form instance

const parseMaybeJsonDeep = (val: any): any => {
    if (typeof val === "string") {
        const trimmed = val.trim()
        if (
            (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
            (trimmed.startsWith("[") && trimmed.endsWith("]"))
        ) {
            try {
                return JSON.parse(trimmed)
            } catch {
                return val
            }
        }
        return val
    }
    if (Array.isArray(val)) return val.map(parseMaybeJsonDeep)
    if (isPlainObject(val)) {
        const result: Record<string, unknown> = {}
        Object.entries(val).forEach(([k, v]) => {
            result[k] = parseMaybeJsonDeep(v)
        })
        return result
    }
    return val
}

const FormView: FC<FormViewProps> = ({value, onChange, customRender}) => {
    const [form] = Form.useForm()
    const [formValuesRef, setFormValuesRef] = useState<Record<string, unknown>>({})
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
    const toggleFold = useCallback((key: string) => {
        setCollapsed((prev) => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }, [])

    useEffect(() => {
        const newValues = prepareInitialValues(value) as any
        setFormValuesRef(newValues)
    }, [value])

    const handleValuesChange = useCallback(
        (_: any, allValues: any) => {
            const merged = merge(formValuesRef, allValues)
            const parsed = parseMaybeJsonDeep(merged)
            onChange(parsed)
        },
        [setFormValuesRef, formValuesRef],
    )

    const handleRename = useCallback(
        (path: (string | number)[], newKey: string) => {
            const newValues = renameKey(formValuesRef, path, newKey)
            onChange(newValues)
        },
        [form, formValuesRef],
    )

    useEffect(() => {
        form.setFieldsValue(formValuesRef)
    }, [formValuesRef])

    const boundHandleValuesChange = useCallback(
        (path: (string | number)[], newValue: any) => {
            const updatedRoot = structuredClone(formValuesRef)

            // walk to parent
            const parent = path.slice(0, -1).reduce<any>((acc, key) => acc[key], updatedRoot)
            const lastKey = path[path.length - 1]
            if (parent !== undefined) {
                ;(parent as any)[lastKey as any] = newValue
                onChange(updatedRoot)
            }
        },
        [formValuesRef, onChange],
    )

    const boundHandleRename = useCallback(
        (path: (string | number)[], newKey: string) => {
            handleRename(path, newKey)
        },
        [handleRename],
    )

    return formValuesRef ? (
        <div className={styles["form-view"]}>
            <Form
                form={form}
                layout="vertical"
                onValuesChange={handleValuesChange}
                initialValues={formValuesRef}
            >
                {Object.entries(formValuesRef).map(([k, v]) => (
                    <Fragment key={k}>
                        {renderNode({
                            form,
                            path: [k],
                            k,
                            value: v,
                            depth: 0,
                            collapsed,
                            toggleFold,
                            onChange: boundHandleValuesChange,
                            customRender,
                            handleRename: boundHandleRename,
                        })}
                    </Fragment>
                ))}
            </Form>
        </div>
    ) : null
}

export default FormView
