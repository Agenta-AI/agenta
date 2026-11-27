import {memo} from "react"

import {useT} from "@agenta/i18n"
import uiStatusCatalog from "@agenta/i18n/catalogs/ui.status"
import {inferLogicalType, type LogicalType} from "@agenta/shared/utils"

import {cn} from "../../foundation/utils/cn"
import {Badge, badgeVariants, type BadgeVariant} from "../../primitives/badge"

export type TypePrimitive = LogicalType

export type RenderHint = "markdown" | "messages" | "tool-calls"

export type StateChip =
    | "dotted-key"
    | "mixed"
    | "collision"
    | "not-authored"
    | "shadowed"
    | "path"
    | "unused"
    | "draft"
    | "chain"
    | "optional"

export type ChipVariant = TypePrimitive | RenderHint | StateChip

export interface TypeChipProps {
    variant?: ChipVariant
    value?: unknown
    label?: string
    ambiguousOnly?: boolean
    onClick?: () => void
}

// Neutral by default; a status tone only where the chip reports a problem.
const STYLES: Record<
    ChipVariant,
    {label: string; tone?: BadgeVariant; dashed?: boolean; italic?: boolean}
> = {
    string: {label: "string"},
    number: {label: "number"},
    boolean: {label: "boolean"},
    null: {label: "null"},
    "json-object": {label: "object"},
    "json-array": {label: "array"},
    markdown: {label: "markdown", dashed: true, italic: true},
    messages: {label: "messages", dashed: true, italic: true},
    "tool-calls": {label: "tool-calls", dashed: true, italic: true},
    "dotted-key": {label: "dotted-key", tone: "warning"},
    mixed: {label: "mixed", tone: "warning"},
    collision: {label: "⚠ collision", tone: "destructive"},
    shadowed: {label: "⚠ shadowed", tone: "destructive"},
    "not-authored": {label: "not authored"},
    optional: {label: "optional"},
    path: {label: "path"},
    unused: {label: "unused"},
    draft: {label: "draft", tone: "info", dashed: true},
    chain: {label: "chain", tone: "info"},
}

const AMBIGUOUS_HIDE = new Set<ChipVariant>(["string", "number", "boolean"])

// Delegates to shared native-type inference. Strings that contain JSON or
// primitive literals remain strings; explicit decode flows parse separately.
const inferVariant = inferLogicalType

function TypeChipImpl({variant, value, label, ambiguousOnly, onClick}: TypeChipProps) {
    const t = useT(uiStatusCatalog)
    const resolved: ChipVariant = variant ?? (value !== undefined ? inferVariant(value) : "string")
    if (ambiguousOnly && AMBIGUOUS_HIDE.has(resolved)) return null

    const style = STYLES[resolved] ?? STYLES.string
    const text = label ?? style.label
    const tone = style.tone ?? "default"
    const chipClass = cn(
        "font-mono select-none",
        style.dashed && "border border-dashed border-current",
        style.italic && "italic",
    )

    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                aria-label={t("ui.status.typeLabel", {type: text})}
                className={cn(
                    badgeVariants({variant: tone}),
                    chipClass,
                    "cursor-pointer transition-transform hover:-translate-y-px",
                )}
            >
                {text}
            </button>
        )
    }

    return (
        <Badge variant={tone} className={chipClass}>
            {text}
        </Badge>
    )
}

export const TypeChip = memo(TypeChipImpl)

export default TypeChip
