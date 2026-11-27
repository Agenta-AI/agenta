import {useState} from "react"

import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import {detectValueShape} from "@agenta/shared/utils"
import {Button, CollapseCaret, cn} from "@agenta/ui/ui"

import {CopyValueButton} from "./CopyValueButton"
import {ValueBody} from "./ValueField"

/** A nested object or array longer than this as JSON starts folded. */
export const NESTED_FOLD_CHARS = 80

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const NESTED_SHAPES = new Set(["object-flat", "object-nested", "array-objects"])

/** An object or a list of objects folds in its row; a chat, a list of words or a text does not. */
const isNested = (value: unknown) => {
    if (!Array.isArray(value) && !isRecord(value)) return false
    return NESTED_SHAPES.has(detectValueShape(value).shape)
}

export interface ValueRowsProps {
    /** An object (one row per key) or an array (one row per item). */
    value: Record<string, unknown> | unknown[]
    /** 0 for a field's own rows, drawn on a muted box; nested rows sit in their parent row. */
    depth?: number
    /** Open every level (the full view). */
    unfolded?: boolean
    stateKey: string
}

const NestedValue = ({
    value,
    depth,
    unfolded,
    stateKey,
}: {
    value: Record<string, unknown> | unknown[]
    depth: number
    unfolded: boolean
    stateKey: string
}) => {
    const t = useT(valueViewCatalog)
    const json = JSON.stringify(value) ?? ""
    const [open, setOpen] = useState(unfolded || json.length <= NESTED_FOLD_CHARS)
    const count = Array.isArray(value)
        ? t("chat.valueView.items", {count: value.length})
        : t("chat.valueView.fields", {count: Object.keys(value).length})
    const summary = open
        ? count
        : t("chat.valueView.size", {
              lines: count,
              characters: t("chat.valueView.characters", {
                  count: json.length,
                  n: json.length.toLocaleString(),
              }),
          })
    return (
        <div className="flex min-w-0 flex-col gap-1">
            <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-expanded={open}
                className="-ml-1.5 self-start text-foreground aria-expanded:bg-transparent"
                onClick={() => setOpen((next) => !next)}
            >
                <CollapseCaret open={open} />
                {summary}
            </Button>
            {open ? (
                <ValueRows
                    value={value}
                    depth={depth + 1}
                    unfolded={unfolded}
                    stateKey={stateKey}
                />
            ) : null}
        </div>
    )
}

/**
 * Key and value rows: one line per key, monospace keys, values drawn by their shape. A nested
 * object or array folds behind a caret with its count. Each top-level row copies its value on
 * hover.
 */
export const ValueRows = ({value, depth = 0, unfolded = false, stateKey}: ValueRowsProps) => {
    const rows: [string, unknown][] = Array.isArray(value)
        ? value.map((item, index) => [String(index), item])
        : Object.entries(value)
    const nested = depth > 0
    return (
        <div
            className={cn("min-w-0", nested ? "flex flex-col" : "rounded-lg bg-muted px-3 py-0.5")}
        >
            {rows.map(([key, item]) => (
                <div
                    key={key}
                    className={cn(
                        "group/row grid min-w-0 items-start",
                        nested
                            ? "grid-cols-[auto_minmax(0,1fr)] gap-2 py-0.5"
                            : "grid-cols-[110px_minmax(0,1fr)_auto] gap-3 border-0 border-b border-solid border-border-muted py-[7px] last:border-b-0",
                    )}
                >
                    <span
                        title={key}
                        className="max-w-40 truncate font-mono text-code-sm leading-5 text-muted-foreground"
                    >
                        {key}
                    </span>
                    <div className="min-w-0 text-body-sm">
                        {isNested(item) ? (
                            <NestedValue
                                value={item as Record<string, unknown> | unknown[]}
                                depth={depth}
                                unfolded={unfolded}
                                stateKey={`${stateKey}.${key}`}
                            />
                        ) : (
                            <ValueBody
                                value={item}
                                depth={depth + 1}
                                unfolded={unfolded}
                                stateKey={`${stateKey}.${key}`}
                            />
                        )}
                    </div>
                    {nested ? null : (
                        <CopyValueButton
                            value={item}
                            className="opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100"
                        />
                    )}
                </div>
            ))}
        </div>
    )
}
