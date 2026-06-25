/**
 * HarnessSelectControl
 *
 * Harness picker for the agent config. The agent_config catalog schema ships `harness` as an
 * enum (`pi_core` / `pi_agenta` / `claude`) PLUS a `oneOf` of `{const, title,
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
import {formatEnumLabel} from "@agenta/shared/utils"
import {LabeledField} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/styles"
import {Select, Typography} from "antd"

interface HarnessMeta {
    label: string
    /** 1–2 char monogram shown in the avatar. */
    short: string
    /** Avatar background colour. */
    color: string
}

/**
 * Avatar identity (brand colour + monogram) per harness id. Labels come from the schema
 * `oneOf` title when present (see `titlesFromSchema`); these defaults only supply the avatar
 * and a label fallback. Keyed by the real enum values `pi_core` / `pi_agenta` / `claude`.
 */
const HARNESS_META: Record<string, HarnessMeta> = {
    pi_core: {label: "Pi", short: "Pi", color: "#6b5bd6"},
    pi_agenta: {label: "Pi (Agenta)", short: "Ag", color: "#1c2c3d"},
    claude: {label: "Claude Code", short: "CC", color: "#d97757"},
}

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

/** Resolve display identity, deriving a sensible fallback for unknown harness ids. */
function metaFor(value: string): HarnessMeta {
    const known = HARNESS_META[value]
    if (known) return known
    const label = formatEnumLabel(value)
    const short =
        label
            .replace(/[^A-Za-z0-9]/g, "")
            .slice(0, 2)
            .toUpperCase() || "?"
    return {label, short, color: "#586673"}
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
    onChange,
    description,
    withTooltip = true,
    disabled = false,
    className,
}: HarnessSelectControlProps) {
    // Canonical labels from the schema `oneOf` titles (`Pi` / `Pi (Agenta)` / `Claude Code`);
    // the avatar (and any label the schema omits) still comes from `metaFor`.
    const titles = useMemo(() => titlesFromSchema(schema), [schema])
    const labelFor = (id: string) => titles[id] ?? metaFor(id).label
    const metaWithLabel = (id: string): HarnessMeta => ({...metaFor(id), label: labelFor(id)})

    const options = useMemo(() => {
        const values = Array.isArray(schema?.enum) ? (schema?.enum as unknown[]) : []
        return values.map((v) => {
            const id = String(v)
            return {value: id, label: titles[id] ?? metaFor(id).label}
        })
    }, [schema, titles])

    const tooltipText = description ?? (schema?.description as string | undefined) ?? ""

    return (
        <LabeledField
            label={label}
            description={tooltipText}
            withTooltip={withTooltip && !!label}
            className={cn(className)}
        >
            <Select
                value={value ?? undefined}
                onChange={(val) => onChange(val ?? null)}
                disabled={disabled}
                placeholder="Select harness"
                className="w-full"
                options={options}
                optionLabelProp="label"
                showSearch
                filterOption={(input, option) =>
                    (option?.label?.toString() ?? "").toLowerCase().includes(input.toLowerCase())
                }
                labelRender={(cur) => {
                    const meta = metaWithLabel(String(cur.value))
                    return (
                        <span className="flex items-center gap-2">
                            <HarnessAvatar meta={meta} size={18} />
                            <span>{meta.label}</span>
                        </span>
                    )
                }}
                optionRender={(opt) => {
                    const meta = metaWithLabel(String(opt.value))
                    return (
                        <span className="flex items-center gap-2 py-0.5">
                            <HarnessAvatar meta={meta} size={22} />
                            <Typography.Text>{meta.label}</Typography.Text>
                        </span>
                    )
                }}
            />
        </LabeledField>
    )
})
