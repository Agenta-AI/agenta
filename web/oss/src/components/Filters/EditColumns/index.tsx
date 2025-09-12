import {useCallback, useEffect, useMemo, useState} from "react"

import {Columns} from "@phosphor-icons/react"
import {Button, Checkbox, Popover, Space} from "antd"
import {ColumnsType} from "antd/es/table"
import {useLocalStorage} from "usehooks-ts"

import {formatColumnTitle} from "./assets/helper"
import {EditColumnsProps} from "./assets/types"

const collectColumnByKey = <T,>(columns: ColumnsType<T>, key: string): any | null => {
    for (const col of columns) {
        if (String(col.key) === key) return col
        if ("children" in col && col.children) {
            const found = collectColumnByKey(col.children, key)
            if (found) return found
        }
    }
    return null
}

const collectKeys = <T,>(cols: ColumnsType<T>): string[] => {
    const res: string[] = []
    cols?.forEach((c) => {
        if (c.key) res.push(String(c.key))
        if ("children" in c && c.children && Array.isArray(c.children)) {
            res.push(...collectKeys(c.children))
        }
    })
    return res
}

const EditColumns = <RecordType extends unknown>({
    uniqueKey,
    excludes = [],
    columns,
    onChange,
    buttonText = "Edit columns",
    popoverProps,
    buttonProps,
}: EditColumnsProps<RecordType>) => {
    const defaultHidden = useMemo(() => {
        const keys: string[] = []
        const traverse = (cols: ColumnsType<RecordType>) => {
            cols.forEach((col) => {
                if (excludes.includes(String(col.key))) return
                if ((col as any).defaultHidden) {
                    keys.push(String(col.key))
                }
                if ("children" in col && col.children) {
                    traverse(col.children)
                }
            })
        }
        traverse(columns)
        return keys
    }, [columns, excludes])

    const [hiddenCols, setHiddenCols] = useLocalStorage<string[]>(
        `${uniqueKey}-tableColumnsHidden`,
        defaultHidden,
    )
    const [open, setOpen] = useState(false)

    // Apply defaultHidden ONLY if there is no saved value yet.
    useEffect(() => {
        if (!hiddenCols.length && defaultHidden.length > 0) {
            setHiddenCols(defaultHidden)
        }
    }, [defaultHidden])

    useEffect(() => {
        onChange?.(hiddenCols)
    }, [hiddenCols])

    const toggleColumn = useCallback(
        (key: string) => {
            const col = collectColumnByKey(columns, key)
            let keys = [key]
            if (col && "children" in col && Array.isArray(col.children)) {
                // include the parent + all descendant keys
                keys = [key, ...collectKeys(col.children)]
            }
            setHiddenCols((prev) => {
                let next = [...prev]
                keys.forEach((k) => {
                    if (next.includes(k)) next = next.filter((x) => x !== k)
                    else next.push(k)
                })
                return next
            })
        },
        [columns, setHiddenCols],
    )

    const buildItems = useCallback(
        (cols: ColumnsType<RecordType>, level = 0): {key: string; label: React.ReactNode}[] => {
            return cols
                .filter(Boolean)
                .filter((col) => !excludes.includes(String(col.key)))
                .flatMap((col) => {
                    if (col.key === "key") return []
                    const key = String(col.key)
                    const item = {
                        key,
                        label: (
                            <Space className={level ? "ml-4" : undefined}>
                                <Checkbox checked={!hiddenCols.includes(key)} />
                                {typeof col.title === "string"
                                    ? col.title
                                    : typeof col.dataIndex === "string"
                                      ? formatColumnTitle(col.dataIndex)
                                      : ""}
                            </Space>
                        ),
                    }
                    const children =
                        "children" in col && col.children ? buildItems(col.children, level + 1) : []
                    return [item, ...children!]
                })
        },
        [hiddenCols, excludes],
    )

    return (
        <Popover
            {...popoverProps}
            trigger="click"
            arrow={false}
            open={open}
            onOpenChange={setOpen}
            placement="bottomLeft"
            classNames={{body: "!p-2"}}
            content={
                <div className="max-w-[200px] max-h-[300px] overflow-auto">
                    {buildItems(columns).map((item) => (
                        <div
                            key={item.key}
                            onClick={() => {
                                toggleColumn(String(item.key))
                            }}
                            className="px-2 py-1.5 hover:bg-gray-100 cursor-pointer flex items-center rounded-lg select-none"
                        >
                            {item.label}
                        </div>
                    ))}
                </div>
            }
        >
            <Button {...buttonProps} icon={<Columns size={14} />}>
                {buttonText}
            </Button>
        </Popover>
    )
}

export default EditColumns
