import type {EvaluatorCatalogTemplate} from "@agenta/entities/workflow"
import {Spinner} from "@agenta/ui/ui"
import {CaretRight} from "@phosphor-icons/react"

/**
 * One template in the picker: its name and category, then its whole description. The row is a
 * button, so the keyboard reaches every template.
 */
export const EvaluatorTemplateRow = ({
    template,
    categories,
    pending,
    disabled,
    onPick,
}: {
    template: EvaluatorCatalogTemplate
    /** The template's category labels, for example "Classifiers". */
    categories: readonly string[]
    /** This template is being prepared: the row shows a spinner. */
    pending: boolean
    disabled: boolean
    onPick: () => void
}) => (
    <button
        type="button"
        disabled={disabled}
        onClick={onPick}
        className="group box-border flex w-full cursor-pointer items-center gap-3 rounded-lg border-0 bg-transparent px-3 py-2.5 text-left font-[inherit] text-foreground outline-none transition-colors hover:bg-colorFillTertiary focus-visible:bg-colorFillTertiary focus-visible:ring-2 focus-visible:ring-[color:var(--ag-controlOutline)] disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
    >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
                <span
                    data-slot="template-name"
                    className="text-sm font-medium leading-5 text-foreground"
                >
                    {template.name || template.key}
                </span>
                {categories.map((category) => (
                    <span
                        key={category}
                        className="rounded-sm bg-muted px-1.5 py-0.5 text-[12px] leading-4 text-muted-foreground"
                    >
                        {category}
                    </span>
                ))}
            </span>
            {template.description ? (
                <span className="text-[13px] leading-snug text-muted-foreground">
                    {template.description}
                </span>
            ) : null}
        </span>
        <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
            {pending ? (
                <Spinner size="small" />
            ) : (
                <CaretRight
                    aria-hidden
                    size={14}
                    className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                />
            )}
        </span>
    </button>
)
