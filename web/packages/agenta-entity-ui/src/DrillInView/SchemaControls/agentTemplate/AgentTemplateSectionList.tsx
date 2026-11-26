/**
 * AgentTemplateSectionList
 *
 * Renders the agent config panel's accordion: one {@link ConfigAccordionSection} per descriptor,
 * or the empty note when the resolved schema declares no agent fields.
 *
 * Presentational — every descriptor arrives fully resolved (title, badge, indicator, content), so
 * this file holds no atom reads and is storiable with plain props. The container
 * (`AgentTemplateControl`) owns the data and builds the descriptors.
 *
 * Migrated from antd `Typography.Text type="secondary"` → a `<span>` on the same token
 * (`colorTextDescription`, which is what antd's `type="secondary"` resolves to).
 */
import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import {
    ConfigAccordionSection,
    sectionIndicatorColor,
    type SectionIndicatorTone,
} from "@agenta/ui/components/presentational"
import {PhonePrimaryAction} from "@agenta/ui/phone"
import {CaretRight} from "@phosphor-icons/react"

import {usePhoneSections, type PhoneSectionsApi} from "./phoneSections"
import {SectionEmptyActionContext, type SectionEmptyAction} from "./SectionEmpty"
import {useSectionListLayout} from "./sectionListLayout"
import {SectionPageRow} from "./SectionPageRow"

/** One config section, fully resolved by the container. */
export interface AgentTemplateSectionDescriptor {
    key: string
    icon?: ReactNode
    title: ReactNode
    /** Short status pill after the title (see SectionTitleBadge). */
    titleBadge?: ReactNode
    summary?: ReactNode
    /**
     * The section holds nothing. The panel row then shows no summary (canvas F01, F02); the
     * phone and the builder pane keep the "None" summary (M07, B03).
     */
    empty?: boolean
    /** In the panel, the header summary of a section that holds items, in place of `summary`. */
    panelSummary?: ReactNode
    /**
     * On a phone, the row's summary line in place of `summary`, where the phone canvas (M07) says
     * more than the desktop header ("AGENTS.md · 33 words", the skill names).
     */
    phoneSummary?: ReactNode
    /** Header-right slot, before the chevron (the "+" add button). */
    extra?: ReactNode
    indicator?: {tone: SectionIndicatorTone; tooltip?: ReactNode; pulse?: boolean}
    defaultOpen?: boolean
    /**
     * On a phone, the section screen's one primary action ("Add integration"): a full-width button
     * at the bottom of the screen, in place of `extra`. The phone host must make its scroll column
     * a size container (`[container-type:size]`), or the screen is a full viewport tall.
     */
    phoneAction?: {label: string; icon?: ReactNode; onClick: () => void}
    /**
     * On the Configuration page (layout "page"), the action at the right of the section title:
     * "Change", "Edit" or "Add" (canvas A04). Use {@link SectionPageAction}. "Add" opens the
     * section's own add flow: the page draws a text button, not the panel's "+" menu.
     */
    pageAction?: ReactNode
    /**
     * On the Configuration page, the card's content in place of `content` (or of the one row a
     * section that opens a view draws): the Advanced parts, the Permissions policy row.
     */
    pageContent?: ReactNode
    /**
     * In the panel, the section is one card that opens a view, with a preview under its title
     * (Instructions). The phone, the page and the builder pane keep `content`.
     */
    panelCard?: {onOpen: () => void; summary?: ReactNode; badge?: ReactNode; preview: ReactNode}
    /** In the panel, the first action an empty section offers on its empty line (STATE-01). */
    emptyAction?: SectionEmptyAction
    /** On a phone the section screen shows no `extra` (its add control): the add view is read only there. */
    hideExtraOnPhone?: boolean
    /** When set, the header opens a drawer instead of expanding inline. */
    onOpen?: () => void
    /** A row that opens a view ends with the canvas triangle instead of a chevron (Advanced). */
    drawerAffordance?: "chevron" | "triangle"
    /** Tint the header row (a container's mark, the builder page's "Changed by the builder"). */
    highlight?: boolean
    bodyClassName?: string
    /**
     * The body is one card set under the title: in the panel it is indented 22 px and sits 6 px
     * under the row (canvas F01, the AGENTS.md card).
     */
    insetBody?: boolean
    content: ReactNode
}

export interface AgentTemplateSectionListProps {
    sections: AgentTemplateSectionDescriptor[]
    /**
     * Keys whose open state is driven by `openByKey`/`onOpenChange` rather than `defaultOpen`, so
     * the panel can auto-expand a section the agent just populated. Everything else keeps the
     * mount-collapsed-then-unfold `defaultOpen` behaviour.
     */
    controlledKeys?: ReadonlySet<string>
    openByKey?: Record<string, boolean>
    onOpenChange?: (key: string, open: boolean) => void
    /** Shown instead of the list when `sections` is empty. */
    emptyText?: ReactNode
}

export const AgentTemplateSectionList = ({
    sections,
    controlledKeys,
    openByKey,
    onOpenChange,
    emptyText,
}: AgentTemplateSectionListProps) => {
    const t = useT(configItemsCatalog)
    const phoneSections = usePhoneSections()
    const layout = useSectionListLayout()
    if (sections.length === 0) {
        // antd `Typography.Text type="secondary"` = colorTextDescription + `word-break: break-word`.
        // Its line-height token does NOT apply here: the call site already carried `text-xs`, and
        // the Tailwind sheet is injected after antd's cssinjs, so 16px is what antd rendered.
        return (
            <span className="break-words text-meta text-muted-foreground">
                {emptyText ?? t("entityUi.configItems.noConfigFields")}
            </span>
        )
    }

    if (phoneSections) return <PhoneSectionList sections={sections} phoneSections={phoneSections} />
    if (layout === "page") return <PageSectionList sections={sections} />

    const pane = layout === "pane"
    return (
        // Canvas F01 for the panel, B03 for the pane: there the rows run full width, so `-mx-4`
        // undoes the host's inset and the rows carry it.
        <div className={pane ? "-mx-4 flex flex-col" : "flex flex-col gap-2 pt-3"}>
            {sections.map((s) => {
                const controlled = Boolean(controlledKeys?.has(s.key))
                const card = pane ? undefined : s.panelCard
                return (
                    // An anchor per section, so a host can list the sections and scroll to one.
                    <div
                        key={s.key}
                        data-config-section={s.key}
                        data-config-section-title={
                            typeof s.title === "string" ? s.title : undefined
                        }
                    >
                        <ConfigAccordionSection
                            icon={s.icon}
                            title={s.title}
                            titleBadge={card?.badge ?? s.titleBadge}
                            summary={
                                card
                                    ? card.summary
                                    : !pane && s.empty
                                      ? undefined
                                      : ((!pane && s.panelSummary) || s.summary)
                            }
                            preview={card?.preview}
                            extra={s.extra}
                            indicator={s.indicator}
                            onOpen={card?.onOpen ?? s.onOpen}
                            drawerAffordance={s.drawerAffordance}
                            highlight={s.highlight}
                            bodyClassName={
                                s.bodyClassName ??
                                (pane
                                    ? "flex flex-col gap-2 px-4 pb-4 pt-3"
                                    : s.insetBody
                                      ? PANEL_INSET_BODY
                                      : PANEL_BODY)
                            }
                            // Canvas F01: rows inset in the panel's `px-4`; the builder pane keeps
                            // its full-width dividers (B03).
                            canvas={pane ? "pane" : "panel"}
                            // The panel's section cards sit 8 px apart, with no dividers.
                            noDivider={!pane}
                            // The section icon sits on the same Mark as its item rows.
                            iconTile={!pane}
                            {...(controlled
                                ? {
                                      open: openByKey?.[s.key] ?? s.defaultOpen ?? false,
                                      onOpenChange: (open: boolean) => onOpenChange?.(s.key, open),
                                  }
                                : {defaultOpen: s.defaultOpen, animateInitialOpen: true})}
                        >
                            <SectionEmptyActionContext.Provider
                                value={pane ? null : (s.emptyAction ?? null)}
                            >
                                {s.content}
                            </SectionEmptyActionContext.Provider>
                        </ConfigAccordionSection>
                    </div>
                )
            })}
        </div>
    )
}

/** The body of an open panel section (canvas F01, with the list's gap). */
const PANEL_BODY = "flex flex-col gap-1 py-0.5"
/** A body that is one row under the title (see `insetBody`); its Mark stays on the line (ALIGN-01). */
const PANEL_INSET_BODY = "flex flex-col py-0.5"

/** The phone row's summary line. */
const summaryOf = (s: AgentTemplateSectionDescriptor) => s.phoneSummary ?? s.summary

/** The section's change or validation dot, after its title on a phone and on the page. */
const IndicatorDot = ({indicator}: {indicator: AgentTemplateSectionDescriptor["indicator"]}) =>
    indicator ? (
        <span
            aria-hidden
            data-section-indicator={indicator.tone}
            className="size-1.5 shrink-0 rounded-round"
            style={{background: sectionIndicatorColor(indicator.tone)}}
        />
    ) : null

/** A section's title as text, for its header on a phone and on the page; the key otherwise. */
const sectionTitle = (s: AgentTemplateSectionDescriptor) =>
    typeof s.title === "string" ? s.title : s.key

/**
 * The sections on a phone: one row per section with its current value, or the open section as its
 * own screen (the container draws its header). A section that opens a view opens it from its row.
 */
const PhoneSectionList = ({
    sections,
    phoneSections,
}: {
    sections: AgentTemplateSectionDescriptor[]
    phoneSections: PhoneSectionsApi
}) => {
    const shown = sections.find((s) => s.key === phoneSections.shownKey && !s.onOpen)
    if (shown) {
        return (
            <div
                data-config-section={shown.key}
                // With a primary action the column fills its container's height (the phone
                // container is a size container), so the action sits at the bottom of the screen.
                className={`flex flex-col gap-3 pt-3 ${shown.phoneAction ? "min-h-[100cqh]" : "pb-6"}`}
            >
                {shown.extra && !shown.phoneAction && !shown.hideExtraOnPhone ? (
                    <div className="flex justify-end">{shown.extra}</div>
                ) : null}
                {shown.content}
                {shown.phoneAction ? (
                    <PhonePrimaryAction
                        className="-mx-4"
                        icon={shown.phoneAction.icon}
                        onClick={shown.phoneAction.onClick}
                    >
                        {shown.phoneAction.label}
                    </PhonePrimaryAction>
                ) : null}
            </div>
        )
    }
    return (
        // Two-line rows 8 px apart, no dividers (ROW-04, SURF-01); each row hangs its hover fill
        // 8 px out, so its Mark stays on the screen's content line (ALIGN-01).
        <div className="-mx-2 flex flex-col gap-2" data-testid="phone-section-list">
            {sections.map((s) => (
                <button
                    key={s.key}
                    type="button"
                    data-config-section={s.key}
                    data-config-section-title={sectionTitle(s)}
                    className="flex min-h-row-double w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-2 py-2 text-left font-[inherit] hover:bg-accent active:bg-accent"
                    onClick={() =>
                        s.onOpen ? s.onOpen() : phoneSections.show(s.key, sectionTitle(s))
                    }
                >
                    {s.icon ? (
                        <span
                            aria-hidden
                            // A 32 px Mark with a 16 px glyph (CONS-01).
                            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground [&_svg]:size-4"
                        >
                            {s.icon}
                        </span>
                    ) : null}
                    <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-body leading-5 text-foreground">
                                {s.title}
                            </span>
                            <IndicatorDot indicator={s.indicator} />
                            {s.titleBadge ? <span className="shrink-0">{s.titleBadge}</span> : null}
                        </span>
                        {summaryOf(s) ? (
                            <span className="truncate text-meta text-muted-foreground">
                                {summaryOf(s)}
                            </span>
                        ) : null}
                    </span>
                    <CaretRight size={14} aria-hidden className="shrink-0 text-muted-foreground" />
                </button>
            ))}
        </div>
    )
}

/**
 * The sections on the Configuration page (canvas A04): per section a title row with its action,
 * then one white card that holds the section's content, always open. A section that opens a view
 * (Model, Advanced) is one row in its card.
 */
const PageSectionList = ({sections}: {sections: AgentTemplateSectionDescriptor[]}) => (
    <div className="flex flex-col gap-7">
        {sections.map((s) => (
            <section
                key={s.key}
                data-config-section={s.key}
                data-config-section-title={sectionTitle(s)}
                className="flex flex-col gap-2"
            >
                <div className="flex min-h-7 items-center justify-between gap-2">
                    <h3 className="m-0 flex min-w-0 items-center gap-1.5 text-title text-foreground">
                        <span className="truncate">{s.title}</span>
                        <IndicatorDot indicator={s.indicator} />
                        {s.titleBadge ? <span className="shrink-0">{s.titleBadge}</span> : null}
                    </h3>
                    {s.pageAction ? <span className="shrink-0">{s.pageAction}</span> : null}
                </div>
                <div className="overflow-hidden rounded-lg border border-solid border-border-muted bg-background">
                    {s.pageContent ? (
                        s.pageContent
                    ) : s.onOpen ? (
                        <SectionPageRow
                            icon={s.icon}
                            title={s.title}
                            summary={s.summary}
                            onClick={s.onOpen}
                        />
                    ) : (
                        // Flat rows draw a line above themselves: -mt-px tucks the first one under
                        // the card's edge, and a list of rows keeps no gap. Content with no rows
                        // (an empty line, a notice) gets the card's padding instead, and an empty
                        // line reads 13/20 (canvas A04 `.cpe`).
                        <div className="-mt-px flex flex-col empty:hidden [&:not(:has([data-page-row]))]:mt-0 [&:not(:has([data-page-row]))]:p-3.5 [&:not(:has([data-page-row]))>span]:!text-label [&:not(:has([data-page-row]))>span]:!leading-5 [&_:has([data-page-row])]:gap-0">
                            {s.content}
                        </div>
                    )}
                </div>
            </section>
        ))}
    </div>
)
