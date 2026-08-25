import {useState} from "react"

import {
    AGENT_TEMPLATES,
    ALL_TEMPLATES_CATEGORY,
    TEMPLATE_CATEGORY_ORDER,
    type AgentStarterTemplate,
} from "@agenta/entities/workflow"
import {TemplateCard} from "@agenta/home-ui"
import {useAtom} from "jotai"
import {ChevronLeft, ChevronRight, EyeOff} from "lucide-react"

import {FIRST_RUN_COPY} from "./copy"
import {TemplatePagerButton} from "./TemplatePagerButton"
import {templatesHiddenAtom} from "./templatesHidden"

/** Matches the desktop strip's `PAGE_SIZE`, and the `lg:grid-cols-3` the cards page through. */
const TEMPLATE_PAGE_SIZE = 3

/**
 * The templates offer on first run, aligned with the desktop's strip: real template CARDS with
 * their monogram, description and the connections they need — not three text chips that fill the
 * composer and teach nothing about what a template is.
 *
 * At `lg` it pages 3-at-a-time behind the desktop's arrows; narrower, where there is no width for
 * a page, the same cards scroll horizontally and the pager hides. The category filter above them
 * is the desktop's tab row, wrapped into chips.
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
    const [hidden, setHidden] = useAtom(templatesHiddenAtom)
    const [page, setPage] = useState(0)
    const categories = [ALL_TEMPLATES_CATEGORY, ...TEMPLATE_CATEGORY_ORDER]
    const shown =
        category === ALL_TEMPLATES_CATEGORY
            ? AGENT_TEMPLATES
            : AGENT_TEMPLATES.filter((template) => template.category === category)

    // Clamped rather than stored raw: a narrower category can have fewer pages than the one that
    // set `page`, and the counter would then name a window with no cards in it.
    const pageCount = Math.max(1, Math.ceil(shown.length / TEMPLATE_PAGE_SIZE))
    const safePage = Math.min(page, pageCount - 1)
    const pageStart = safePage * TEMPLATE_PAGE_SIZE
    const pageEnd = Math.min(pageStart + TEMPLATE_PAGE_SIZE, shown.length)
    const atStart = safePage === 0
    const atEnd = safePage >= pageCount - 1

    // Dismissed: one line that says where they went and takes them back, same as the desktop.
    if (hidden) {
        return (
            <div className="text-muted-foreground text-xs">
                {FIRST_RUN_COPY.templatesHidden} ·{" "}
                <button
                    type="button"
                    onClick={() => setHidden(false)}
                    className="text-foreground cursor-pointer border-0 bg-transparent p-0 text-xs underline underline-offset-[3px]"
                >
                    {FIRST_RUN_COPY.showAgain}
                </button>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{FIRST_RUN_COPY.templates}</span>
                <div className="flex items-center gap-3">
                    {/*
                     * The desktop's pager, and `lg`-only on purpose: below that the cards are a
                     * snap scroller with no discrete pages, so a "1–3 of 28" counter would name a
                     * window the user is not in.
                     */}
                    <div className="hidden items-center gap-1.5 lg:flex">
                        <span className="text-muted-foreground mr-0.5 text-xs">
                            {FIRST_RUN_COPY.templateCounter(pageStart + 1, pageEnd, shown.length)}
                        </span>
                        <TemplatePagerButton
                            label={FIRST_RUN_COPY.prevTemplates}
                            disabled={atStart}
                            onClick={() => setPage(safePage - 1)}
                        >
                            <ChevronLeft size={14} />
                        </TemplatePagerButton>
                        <TemplatePagerButton
                            label={FIRST_RUN_COPY.nextTemplates}
                            disabled={atEnd}
                            onClick={() => setPage(safePage + 1)}
                        >
                            <ChevronRight size={14} />
                        </TemplatePagerButton>
                    </div>
                    <button
                        type="button"
                        onClick={onBrowseAll}
                        className="text-muted-foreground hover:text-foreground cursor-pointer border-0 bg-transparent p-0 text-xs underline-offset-2 hover:underline"
                    >
                        {FIRST_RUN_COPY.browseAll(AGENT_TEMPLATES.length)}
                    </button>
                    {/* The desktop hides this behind a `⋯` menu holding exactly one item; on touch
                        that is two taps for one action, so it is a labelled button here. */}
                    <button
                        type="button"
                        onClick={() => setHidden(true)}
                        aria-label={FIRST_RUN_COPY.hideTemplates}
                        title={FIRST_RUN_COPY.hideTemplates}
                        className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center border-0 bg-transparent p-0"
                    >
                        <EyeOff size={14} />
                    </button>
                </div>
            </div>

            {/* Negative margin + matching padding so the row bleeds to the screen edge while its
                first and last cards still clear the page gutter. */}
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                {categories.map((entry) => (
                    <button
                        key={entry}
                        type="button"
                        onClick={() => {
                            setCategory(entry)
                            setPage(0)
                        }}
                        aria-pressed={entry === category}
                        className={`box-border shrink-0 cursor-pointer rounded-full border border-solid px-3 py-1 text-xs transition-colors ${
                            entry === category
                                ? "border-foreground bg-foreground text-background"
                                : "border-border text-muted-foreground hover:text-foreground bg-transparent"
                        }`}
                    >
                        {entry}
                        <span className="ml-1.5 opacity-60">
                            {entry === ALL_TEMPLATES_CATEGORY
                                ? AGENT_TEMPLATES.length
                                : AGENT_TEMPLATES.filter((t) => t.category === entry).length}
                        </span>
                    </button>
                ))}
            </div>

            {/*
             * Two shapes, one DOM. Narrow: a snap scroller that bleeds to the screen edge.
             * From `lg`: a three-across row that fits the column, so `/m` on a desktop is a
             * desktop layout — not a phone scroller with cards running off the right edge.
             * `pt-7` is headroom for the monogram: it overhangs the card's top edge by 20px and
             * carries a 2px ring, so at pt-5 it sat flush against the row and the ring clipped.
             */}
            <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 pt-7 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0">
                {shown.map((template, index) => (
                    <div
                        key={template.key}
                        // Every card stays mounted so the narrow scroller keeps the whole set; at
                        // `lg` only the current page's three are shown and the arrows move the
                        // window. `lg:min-w-0`: a grid child defaults to min-width:auto, so the
                        // card's long footer string sets a min-content floor and the track
                        // overflows, clipping the cards on the right.
                        className={`w-62 shrink-0 snap-start lg:w-auto lg:min-w-0 ${
                            index >= pageStart && index < pageEnd ? "" : "lg:hidden"
                        }`}
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
