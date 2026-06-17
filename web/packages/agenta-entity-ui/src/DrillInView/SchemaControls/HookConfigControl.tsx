/** Renders the hook workflow data fields (url, headers). */

import {memo, useCallback, useMemo} from "react"

import {LabeledField} from "@agenta/ui/components/presentational"
import {Plus, Trash} from "@phosphor-icons/react"
import {Button, Input} from "antd"
import clsx from "clsx"

type HeadersValue = Record<string, unknown>

interface HeadersControlProps {
    value: HeadersValue
    onChange: (next: HeadersValue) => void
    disabled?: boolean
}

/** Key/value rows for hook headers, with an Add row. */
const HeadersControl = memo(function HeadersControl({
    value,
    onChange,
    disabled,
}: HeadersControlProps) {
    const rows = useMemo(() => Object.entries(value ?? {}), [value])

    const setRow = useCallback(
        (index: number, key: string, val: string) => {
            const next: HeadersValue = {}
            rows.forEach(([k, v], i) => {
                if (i === index) next[key] = val
                else next[k] = v
            })
            onChange(next)
        },
        [rows, onChange],
    )

    const removeRow = useCallback(
        (index: number) => {
            const next: HeadersValue = {}
            rows.forEach(([k, v], i) => {
                if (i !== index) next[k] = v
            })
            onChange(next)
        },
        [rows, onChange],
    )

    const addRow = useCallback(() => {
        // Object-keyed headers can't hold two blank keys; don't stack empties.
        if (Object.prototype.hasOwnProperty.call(value ?? {}, "")) return
        onChange({...value, "": ""})
    }, [value, onChange])

    return (
        <LabeledField label="Headers" direction="vertical">
            <div className="flex flex-col gap-2">
                {rows.map(([key, val], index) => (
                    <div key={index} className="flex items-center gap-2">
                        <Input
                            placeholder="Key"
                            className="basis-1/3 font-mono"
                            value={key}
                            disabled={disabled}
                            onChange={(e) => setRow(index, e.target.value, String(val ?? ""))}
                        />
                        <Input
                            placeholder="Value"
                            className="basis-2/3 font-mono"
                            value={String(val ?? "")}
                            disabled={disabled}
                            onChange={(e) => setRow(index, key, e.target.value)}
                        />
                        <Button
                            type="text"
                            size="small"
                            icon={<Trash size={14} />}
                            disabled={disabled}
                            onClick={() => removeRow(index)}
                        />
                    </div>
                ))}
                <Button
                    variant="outlined"
                    color="default"
                    size="small"
                    icon={<Plus size={14} />}
                    disabled={disabled}
                    onClick={addRow}
                    className="self-start"
                >
                    Header
                </Button>
            </div>
        </LabeledField>
    )
})

export interface HookConfigControlProps {
    /** Current hook group value: {url, headers}. */
    value: Record<string, unknown> | null | undefined
    /** Emits the full updated group object. */
    onChange: (value: Record<string, unknown>) => void
    disabled?: boolean
    className?: string
}

/** Renders the Hook (url + headers) section body. */
export const HookConfigControl = memo(function HookConfigControl({
    value,
    onChange,
    disabled = false,
    className,
}: HookConfigControlProps) {
    const group = (value ?? {}) as Record<string, unknown>

    const patch = useCallback(
        (field: string, fieldValue: unknown) => {
            onChange({...group, [field]: fieldValue})
        },
        [group, onChange],
    )

    return (
        <div className={clsx("flex flex-col gap-4", className)}>
            <LabeledField label="URL" direction="vertical">
                <Input
                    placeholder="https://your-service"
                    className="font-mono"
                    value={(group.url as string) ?? ""}
                    disabled={disabled}
                    onChange={(e) => patch("url", e.target.value)}
                />
            </LabeledField>
            <HeadersControl
                value={(group.headers as HeadersValue) ?? {}}
                onChange={(next) => patch("headers", next)}
                disabled={disabled}
            />
        </div>
    )
})
