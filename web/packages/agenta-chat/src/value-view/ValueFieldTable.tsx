import {detectValueShape, type ValueShape} from "@agenta/shared/utils"

import {ValueField} from "./ValueField"
import {ValueRows} from "./ValueRows"

export interface ValueFieldTableField {
    name: string
    value: unknown
}

const JSON_SHAPES: ReadonlySet<ValueShape> = new Set([
    "object-flat",
    "object-nested",
    "array-objects",
])
const LONG_SHAPES: ReadonlySet<ValueShape> = new Set(["text-long", "markdown", "messages"])

/** Short values first, then JSON, then long text. */
const rankOf = (value: unknown) => {
    const {shape} = detectValueShape(value)
    return LONG_SHAPES.has(shape) ? 2 : JSON_SHAPES.has(shape) ? 1 : 0
}

/**
 * Named values as one key and value table: short fields first, one line each; then JSON fields,
 * folded over 80 characters with their count; then long text with its name above it, folded at
 * 8 lines with "Show all N lines" and "Open full view". Each value is drawn by its shape.
 */
export const ValueFieldTable = ({fields}: {fields: readonly ValueFieldTableField[]}) => {
    const ranked = fields
        .map((field, position) => ({field, position, rank: rankOf(field.value)}))
        .sort((a, b) => a.rank - b.rank || a.position - b.position)
    const rows = ranked.filter(({rank}) => rank < 2).map(({field}) => field)
    const long = ranked.filter(({rank}) => rank === 2).map(({field}) => field)
    const stateKey = fields.map((field) => field.name).join("|")

    return (
        <div className="min-w-0 rounded-lg bg-muted text-body-sm">
            {rows.length > 0 ? (
                <ValueRows
                    value={Object.fromEntries(rows.map((field) => [field.name, field.value]))}
                    stateKey={stateKey}
                />
            ) : null}
            {long.map((field, index) => (
                <div
                    key={field.name}
                    className={`flex min-w-0 flex-col gap-2 border-0 border-solid border-border-muted px-3 py-2 ${
                        rows.length > 0 || index > 0 ? "border-t" : ""
                    }`}
                >
                    <span className="font-mono text-code-sm leading-5 text-muted-foreground">
                        {field.name}
                    </span>
                    <ValueField value={field.value} label={field.name} />
                </div>
            ))}
        </div>
    )
}
