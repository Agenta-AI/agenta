/**
 * HarnessSelectControl
 *
 * Harness picker for the agent config. The agent_config catalog schema ships `harness` as a
 * plain enum (today: pi / claude / agenta) with no per-value metadata, so this control
 * supplies the display identity — an avatar (brand colour + initials) and a label — FE-side,
 * keyed by harness id, and falls back to a derived label/avatar for any harness the backend
 * adds later. The goal (per the agent playground design) is to make the harness choice
 * discoverable rather than a bare dropdown of slugs.
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

/** Display identity for the harnesses the backend currently ships. */
const HARNESS_META: Record<string, HarnessMeta> = {
    pi: {label: "Pi", short: "Pi", color: "#6b5bd6"},
    claude: {label: "Claude Code", short: "CC", color: "#d97757"},
    agenta: {label: "Agenta", short: "Ag", color: "#1c2c3d"},
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
    const options = useMemo(() => {
        const values = Array.isArray(schema?.enum) ? (schema?.enum as unknown[]) : []
        return values.map((v) => {
            const id = String(v)
            return {value: id, label: metaFor(id).label}
        })
    }, [schema])

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
                    const meta = metaFor(String(cur.value))
                    return (
                        <span className="flex items-center gap-2">
                            <HarnessAvatar meta={meta} size={18} />
                            <span>{meta.label}</span>
                        </span>
                    )
                }}
                optionRender={(opt) => {
                    const meta = metaFor(String(opt.value))
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
