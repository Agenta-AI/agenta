import {
    AGENT_TEMPLATES,
    ALL_TEMPLATES_CATEGORY,
    TEMPLATE_CATEGORY_ORDER,
    type AgentStarterTemplate,
} from "@agenta/entities/workflow"
import {TemplateCard} from "@agenta/home-ui"
import {useState} from "react"

import {FIRST_RUN_COPY} from "./copy"

/**
 * The templates offer on first run, aligned with the desktop's strip: real template CARDS with
 * their monogram, description and the connections they need — not three text chips that fill the
 * composer and teach nothing about what a template is.
 *
 * The desktop pages 3-at-a-time with arrows because it has the width. A phone does not, so the
 * same cards scroll horizontally instead; the category filter above them is the desktop's tab row
 * with the counts dropped (they need the full set on screen to mean anything).
 */
export const FirstRunTemplates = ({
    onPick,
    onBrowseAll,
    disabled,
}: {
    onPick: (template: AgentStarterTemplate) => void
    onBrowseAll: () => void
    disabled?: boolean
}) => {
    const [category, setCategory] = useState<string>(ALL_TEMPLATES_CATEGORY)
    const categories = [ALL_TEMPLATES_CATEGORY, ...TEMPLATE_CATEGORY_ORDER]
    const shown =
        category === ALL_TEMPLATES_CATEGORY
            ? AGENT_TEMPLATES
            : AGENT_TEMPLATES.filter((template) => template.category === category)

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{FIRST_RUN_COPY.templates}</span>
                <button
                    type="button"
                    onClick={onBrowseAll}
                    className="text-muted-foreground hover:text-foreground cursor-pointer border-0 bg-transparent p-0 text-xs underline-offset-2 hover:underline"
                >
                    {FIRST_RUN_COPY.browseAll(AGENT_TEMPLATES.length)}
                </button>
            </div>

            {/* Negative margin + matching padding so the row bleeds to the screen edge while its
                first and last cards still clear the page gutter. */}
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                {categories.map((entry) => (
                    <button
                        key={entry}
                        type="button"
                        onClick={() => setCategory(entry)}
                        aria-pressed={entry === category}
                        className={`box-border shrink-0 cursor-pointer rounded-full border border-solid px-3 py-1 text-xs transition-colors ${
                            entry === category
                                ? "border-foreground bg-foreground text-background"
                                : "border-border text-muted-foreground hover:text-foreground bg-transparent"
                        }`}
                    >
                        {entry}
                    </button>
                ))}
            </div>

            {/*
             * Two shapes, one DOM. Narrow: a snap scroller that bleeds to the screen edge.
             * From `lg`: a three-across row that fits the column, so `/m` on a desktop is a
             * desktop layout — not a phone scroller with cards running off the right edge.
             * `pt-5` is headroom for the monogram, which straddles the card's top edge and gets
             * clipped by the scroller without it.
             */}
            <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 pt-5 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0">
                {shown.map((template) => (
                    <div
                        key={template.key}
                        // Past the third card there is no room in the grid; the rest stay one tap
                        // away behind "Browse all", the same bargain the desktop pager makes.
                        className="w-62 shrink-0 snap-start lg:w-auto lg:nth-[n+4]:hidden"
                    >
                        <TemplateCard
                            template={template}
                            onSelect={disabled ? () => undefined : onPick}
                        />
                    </div>
                ))}
            </div>
        </div>
    )
}
