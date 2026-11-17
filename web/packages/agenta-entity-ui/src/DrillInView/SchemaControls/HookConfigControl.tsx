/** Renders the hook workflow data fields (url, headers). */

import {memo, useCallback, useMemo} from "react"

import {useT} from "@agenta/i18n"
import schemaControlsCatalog from "@agenta/i18n/catalogs/entityUi.schemaControls"
import {Button, Field, Input} from "@agenta/ui/ui"
import {Plus, Trash} from "@phosphor-icons/react"
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
    const t = useT(schemaControlsCatalog)
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
        <Field label={t("entityUi.schemaControls.headers")} direction="vertical">
            <div className="flex flex-col gap-2">
                {rows.map(([key, val], index) => (
                    <div key={index} className="flex items-center gap-2">
                        <Input
                            placeholder={t("entityUi.schemaControls.key")}
                            aria-label={t("entityUi.schemaControls.headerKey")}
                            className="basis-1/3 font-mono"
                            value={key}
                            disabled={disabled}
                            onChange={(e) => setRow(index, e.target.value, String(val ?? ""))}
                        />
                        <Input
                            placeholder={t("entityUi.schemaControls.value")}
                            aria-label={t("entityUi.schemaControls.headerValue")}
                            className="basis-2/3 font-mono"
                            value={String(val ?? "")}
                            disabled={disabled}
                            onChange={(e) => setRow(index, key, e.target.value)}
                        />
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("entityUi.schemaControls.removeHeader")}
                            disabled={disabled}
                            onClick={() => removeRow(index)}
                        >
                            <Trash size={14} />
                        </Button>
                    </div>
                ))}
                <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={addRow}
                    className="self-start"
                >
                    <Plus size={14} />
                    {t("entityUi.schemaControls.header")}
                </Button>
            </div>
        </Field>
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
    const t = useT(schemaControlsCatalog)
    const group = (value ?? {}) as Record<string, unknown>

    const patch = useCallback(
        (field: string, fieldValue: unknown) => {
            onChange({...group, [field]: fieldValue})
        },
        [group, onChange],
    )

    return (
        <div className={clsx("flex flex-col gap-4", className)}>
            <Field label={t("entityUi.schemaControls.url")} direction="vertical">
                <Input
                    placeholder="https://your-service"
                    className="font-mono"
                    value={(group.url as string) ?? ""}
                    disabled={disabled}
                    onChange={(e) => patch("url", e.target.value)}
                />
            </Field>
            <HeadersControl
                value={(group.headers as HeadersValue) ?? {}}
                onChange={(next) => patch("headers", next)}
                disabled={disabled}
            />
        </div>
    )
})
