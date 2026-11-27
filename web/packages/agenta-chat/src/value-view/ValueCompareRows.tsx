import {useState} from "react"

import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import {
    detectValueShape,
    type CompareRow,
    type ExpectedComparison,
    type ValueShape,
} from "@agenta/shared/utils"
import {ValueCell} from "@agenta/ui/cell-renderers"
import {Button, CollapseCaret, cn} from "@agenta/ui/ui"
import {Check, X} from "@phosphor-icons/react"

import {ValueField} from "./ValueField"

const Mark = ({status}: {status: CompareRow["status"]}) => {
    const t = useT(valueViewCatalog)
    if (status === "match") {
        return <Check size={14} className="text-success" aria-label={t("chat.valueView.match")} />
    }
    if (status === "mismatch" || status === "missing") {
        return (
            <X
                size={14}
                className="text-destructive"
                aria-label={t(
                    status === "mismatch" ? "chat.valueView.mismatch" : "chat.valueView.missing",
                )}
            />
        )
    }
    return null
}

const failed = (status: CompareRow["status"]) => status === "mismatch" || status === "missing"

const CELL_SHAPES: ReadonlySet<ValueShape> = new Set([
    "empty",
    "boolean",
    "number",
    "url",
    "text-short",
    "array-scalars",
])

/** A short value in one cell; a list, an object or long text with its fold and full view. */
const Leaf = ({name, value}: {name: string; value: unknown}) =>
    CELL_SHAPES.has(detectValueShape(value).shape) ? (
        <ValueCell value={value} lines={3} />
    ) : (
        <ValueField value={value} label={name} />
    )

const Row = ({row}: {row: CompareRow}) => {
    const t = useT(valueViewCatalog)
    const [open, setOpen] = useState(true)
    const group = row.children !== null
    const cell = "px-2 py-1.5 align-top"
    return (
        <>
            <tr
                className={cn(
                    "border-0 border-t border-solid border-border-muted",
                    failed(row.status) && "bg-destructive/10",
                )}
            >
                <td className={cell} style={{paddingLeft: 8 + row.depth * 16}}>
                    {group ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            aria-expanded={open}
                            className="-ml-1.5 h-auto px-1 font-mono text-code-sm text-foreground aria-expanded:bg-transparent"
                            onClick={() => setOpen((next) => !next)}
                        >
                            <CollapseCaret open={open} />
                            {row.key}
                        </Button>
                    ) : (
                        <span className="pl-4 font-mono text-code-sm text-muted-foreground">
                            {row.key}
                        </span>
                    )}
                </td>
                <td className={cn(cell, row.status === "mismatch" && "text-destructive")}>
                    {group ? (
                        <span className="text-muted-foreground">
                            {t("chat.valueView.fields", {count: row.children?.length ?? 0})}
                        </span>
                    ) : (
                        <Leaf name={row.key} value={row.output} />
                    )}
                </td>
                <td className={cell}>
                    {group ? (
                        <span className="text-muted-foreground">
                            {t(
                                failed(row.status)
                                    ? "chat.valueView.differs"
                                    : "chat.valueView.same",
                            )}
                        </span>
                    ) : (
                        <Leaf name={row.key} value={row.expected} />
                    )}
                </td>
                <td className={cn(cell, "w-8 text-right")}>
                    <Mark status={row.status} />
                </td>
            </tr>
            {group && open
                ? row.children?.map((child) => <Row key={child.key} row={child} />)
                : null}
        </>
    )
}

/**
 * An object output next to the value it is expected to be: one row per key with the output, the
 * expected value and a match or mismatch mark per leaf, under the "X of Y fields match" line.
 * `expectedKey` names where the expected value comes from (a test case column).
 */
export const ValueCompareRows = ({
    comparison,
    expectedKey,
}: {
    comparison: ExpectedComparison
    expectedKey: string
}) => {
    const t = useT(valueViewCatalog)
    return (
        <div className="flex min-w-0 flex-col gap-2">
            <p className="m-0 text-body-sm text-muted-foreground">
                {t("chat.valueView.fieldsMatch", {
                    count: comparison.compared,
                    matched: comparison.matched,
                })}
            </p>
            <div className="min-w-0 overflow-x-auto rounded-md border border-solid border-border-muted">
                <table className="w-full border-collapse text-left text-body-sm">
                    <thead>
                        <tr className="bg-muted text-meta text-muted-foreground">
                            <th scope="col" className="px-2 py-1.5 font-normal">
                                {t("chat.valueView.columnField")}
                            </th>
                            <th scope="col" className="px-2 py-1.5 font-normal">
                                {t("chat.valueView.columnOutput")}
                            </th>
                            <th scope="col" className="px-2 py-1.5 font-normal">
                                {t("chat.valueView.columnExpected", {
                                    key: expectedKey,
                                })}
                            </th>
                            <th scope="col" className="w-8" />
                        </tr>
                    </thead>
                    <tbody>
                        {comparison.rows.map((row) => (
                            <Row key={row.key} row={row} />
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
