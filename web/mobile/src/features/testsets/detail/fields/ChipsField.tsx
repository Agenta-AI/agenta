import {useEffect, useState} from "react"

import {CHIPS_SHOWN} from "@agenta/chat/value-view"
import {inferPrimitiveFromText} from "@agenta/entity-ui/testcase"
import {useT} from "@agenta/i18n"
import editorCatalog from "@agenta/i18n/catalogs/testsets.testcaseEditor"
import {Button} from "@agenta/ui/ui"
import {X} from "@phosphor-icons/react"

const chipText = (item: unknown) => (typeof item === "string" ? item : JSON.stringify(item))

/**
 * A list of short values as chips: remove one, add one with Enter. A new item that reads as a
 * number or a boolean is stored as one when the list holds only numbers or booleans.
 */
export const ChipsField = ({
    items,
    collapseSignal,
    onChange,
}: {
    items: unknown[]
    collapseSignal: number
    onChange?: (next: unknown[]) => void
}) => {
    const t = useT(editorCatalog)
    const [all, setAll] = useState(false)
    const [adding, setAdding] = useState(false)
    useEffect(() => setAll(false), [collapseSignal])

    const shown = all ? items : items.slice(0, CHIPS_SHOWN)
    const typed = items.length > 0 && items.every((item) => typeof item !== "string")

    return (
        <div className="flex flex-wrap items-center gap-1 pl-1">
            {shown.map((item, index) => (
                <span
                    key={index}
                    className={`inline-flex h-5.5 items-center gap-0.5 rounded-sm border border-border-muted bg-secondary pl-1.5 font-mono text-meta ${onChange ? "pr-0.5" : "pr-1.5"}`}
                >
                    {chipText(item)}
                    {onChange ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t("testsets.testcaseEditor.removeItem", {
                                value: chipText(item),
                            })}
                            className="opacity-55 hover:opacity-100"
                            onClick={() => onChange(items.filter((_, at) => at !== index))}
                        >
                            <X size={10} aria-hidden />
                        </Button>
                    ) : null}
                </span>
            ))}
            {items.length > CHIPS_SHOWN && !all ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                    onClick={() => setAll(true)}
                >
                    {t("testsets.testcaseEditor.moreItems", {count: items.length - CHIPS_SHOWN})}
                </Button>
            ) : null}
            {onChange && adding ? (
                <input
                    autoFocus
                    aria-label={t("testsets.testcaseEditor.newItem")}
                    placeholder={t("testsets.testcaseEditor.newItem")}
                    className="h-5.5 w-45 rounded-sm border border-border-strong bg-background px-1.5 font-mono text-meta outline-none"
                    onBlur={() => setAdding(false)}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") setAdding(false)
                        if (event.key !== "Enter") return
                        const text = event.currentTarget.value
                        if (text.trim() === "") return
                        onChange([...items, typed ? inferPrimitiveFromText(text) : text])
                        event.currentTarget.value = ""
                    }}
                />
            ) : null}
            {onChange ? (
                <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="border-dashed text-muted-foreground"
                    onClick={() => setAdding(true)}
                >
                    + {t("testsets.testcaseEditor.addItem")}
                </Button>
            ) : null}
        </div>
    )
}
