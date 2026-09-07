/**
 * HarnessSelectControl
 *
 * Harness picker for the agent config. The agent_template catalog schema ships `harness` as an
 * enum (`pi_core` / `claude` / `codex`) PLUS a `oneOf` of `{const, title,
 * x-ag-harness-slug}` whose `title`s are the canonical display names (`Pi` / `Pi (Agenta)` /
 * `Claude Code`, from the backend's `HARNESS_IDENTITIES`). This control prefers that schema
 * `title` for each value's label, and supplies the avatar (brand colour + monogram) FE-side
 * keyed by harness id. Both fall back to a derived label/avatar for any harness the backend
 * adds before the FE map catches up. The goal (per the agent playground design) is to make
 * the harness choice discoverable rather than a bare dropdown of slugs.
 *
 * Per-harness *capabilities* (which would drive availability-gating of the MCP/tools
 * sections) are probed by the backend at run time and are not yet exposed on the schema, so
 * gating is left to the consumer once a contract exists.
 */
import {memo, useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {cn} from "@agenta/ui/styles"
import {Combobox, Field} from "@agenta/ui/ui"

import {harnessMetaFor as metaFor, type HarnessMeta} from "./harnessMeta"

/**
 * Read the canonical display name per harness value from the schema's `oneOf` of
 * `{const, title}` entries (the backend ships these from `HARNESS_IDENTITIES`). Returns an
 * empty map when the schema has no `oneOf`, in which case `HARNESS_META`/derived labels apply.
 */
function titlesFromSchema(schema?: SchemaProperty | null): Record<string, string> {
    const oneOf = (schema as {oneOf?: unknown} | null | undefined)?.oneOf
    if (!Array.isArray(oneOf)) return {}
    const titles: Record<string, string> = {}
    for (const entry of oneOf) {
        const e = entry as {const?: unknown; title?: unknown}
        if (e?.const != null && typeof e.title === "string" && e.title) {
            titles[String(e.const)] = e.title
        }
    }
    return titles
}

function HarnessAvatar({meta, size = 22}: {meta: HarnessMeta; size?: number}) {
    return (
        <span
            className="flex shrink-0 items-center justify-center rounded font-semibold text-white"
            style={{
                width: size,
                height: size,
                background: meta.color,
                fontSize: size <= 18 ? 9 : 10,
                lineHeight: 1,
            }}
        >
            {meta.short}
        </span>
    )
}

export interface HarnessSelectControlProps {
    /** The schema property defining the harness enum. */
    schema?: SchemaProperty | null
    /** Display label for the control. */
    label?: string
    /** Current value. */
    value: string | null | undefined
    /** Optional visible values, used to hide supported but non-selectable harnesses. */
    visibleValues?: string[]
    /** Change handler. */
    onChange: (value: string | null) => void
    /** Optional description for tooltip. */
    description?: string
    /** Whether to show the tooltip. */
    withTooltip?: boolean
    /** Disable the control. */
    disabled?: boolean
    /** Additional CSS classes. */
    className?: string
}

/**
 * A controlled select for choosing the agent harness, with per-harness visual identity.
 */
export const HarnessSelectControl = memo(function HarnessSelectControl({
    schema,
    label,
    value,
    visibleValues,
    onChange,
    description,
    withTooltip = true,
    disabled = false,
    className,
}: HarnessSelectControlProps) {
    // Canonical labels from the schema `oneOf` titles (`Pi` / `Pi (Agenta)` / `Claude Code`);
    // the avatar (and any label the schema omits) still comes from `metaFor`.
    const titles = useMemo(() => titlesFromSchema(schema), [schema])

    // One label node serves both the trigger and the dropdown row — the Combobox has a single
    // `label` slot (antd used `labelRender`/`optionRender` to size the avatar 18 vs 22).
    const options = useMemo(() => {
        const values =
            visibleValues ?? (Array.isArray(schema?.enum) ? (schema.enum as string[]) : [])
        return values.map((v) => {
            const id = String(v)
            const meta: HarnessMeta = {...metaFor(id), label: titles[id] ?? metaFor(id).label}
            return {
                value: id,
                searchValue: meta.label,
                label: (
                    <span className="flex items-center gap-2">
                        <HarnessAvatar meta={meta} size={18} />
                        <span>{meta.label}</span>
                    </span>
                ),
            }
        })
    }, [schema, titles, visibleValues])

    const tooltipText = description ?? (schema?.description as string | undefined) ?? ""

    return (
        <Field
            label={label}
            tooltip={withTooltip && !!label ? tooltipText : undefined}
            className={cn(className)}
        >
            {/* Combobox = antd `showSearch` Select (type in the trigger, filtered list below). */}
            <Combobox
                value={value ?? undefined}
                onChange={(val) => onChange(val ?? null)}
                disabled={disabled}
                placeholder="Select harness"
                className="w-full"
                options={options}
                aria-label={label ? undefined : "Harness"}
            />
        </Field>
    )
})
