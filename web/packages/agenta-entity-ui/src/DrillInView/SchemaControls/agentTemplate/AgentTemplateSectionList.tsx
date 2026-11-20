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
    /** On a phone the section screen shows no `extra` (its add control): the add view is read only there. */
    hideExtraOnPhone?: boolean
    /** When set, the header opens a drawer instead of expanding inline. */
    onOpen?: () => void
    bodyClassName?: string
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
            <span className="break-words text-xs text-colorTextDescription">
                {emptyText ?? t("entityUi.configItems.noConfigFields")}
            </span>
        )
    }

    if (phoneSections) return <PhoneSectionList sections={sections} phoneSections={phoneSections} />
    if (layout === "page") return <PageSectionList sections={sections} />

    return (
        <>
            {sections.map((s, index) => {
                const controlled = Boolean(controlledKeys?.has(s.key))
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
                            titleBadge={s.titleBadge}
                            summary={s.summary}
                            extra={s.extra}
                            indicator={s.indicator}
                            onOpen={s.onOpen}
                            bodyClassName={s.bodyClassName}
                            // Canvas S02: rows inset in the panel's `px-4`, an open section stays
                            // white (no band).
                            canvas
                            noDivider={index === sections.length - 1}
                            {...(controlled
                                ? {
                                      open: openByKey?.[s.key] ?? s.defaultOpen ?? false,
                                      onOpenChange: (open: boolean) => onOpenChange?.(s.key, open),
                                  }
                                : {defaultOpen: s.defaultOpen, animateInitialOpen: true})}
                        >
                            {s.content}
                        </ConfigAccordionSection>
                    </div>
                )
            })}
        </>
    )
}

/** The phone row's summary line. */
const summaryOf = (s: AgentTemplateSectionDescriptor) => s.phoneSummary ?? s.summary

/** The section's change or validation dot, after its title on a phone and on the page. */
const IndicatorDot = ({indicator}: {indicator: AgentTemplateSectionDescriptor["indicator"]}) =>
    indicator ? (
        <span
            aria-hidden
            data-section-indicator={indicator.tone}
            className="size-1.5 shrink-0 rounded-full"
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
        <div className="-mx-4 flex flex-col" data-testid="phone-section-list">
            {sections.map((s) => (
                <button
                    key={s.key}
                    type="button"
                    data-config-section={s.key}
                    data-config-section-title={sectionTitle(s)}
                    className="flex min-h-14 w-full cursor-pointer items-center gap-3 border-0 border-b border-solid border-colorBorderSecondary bg-transparent px-4 py-2 text-left font-[inherit] active:bg-colorFillTertiary"
                    onClick={() =>
                        s.onOpen ? s.onOpen() : phoneSections.show(s.key, sectionTitle(s))
                    }
                >
                    {s.icon ? (
                        <span
                            aria-hidden
                            // Canvas M07: an 18 px glyph in a 32 px warm gray tile.
                            className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--ag-colorBgLayout)] text-[var(--ag-zinc-8)] [&_svg]:size-[18px]"
                        >
                            {s.icon}
                        </span>
                    ) : null}
                    <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[15px] text-colorText">{s.title}</span>
                            <IndicatorDot indicator={s.indicator} />
                            {s.titleBadge ? <span className="shrink-0">{s.titleBadge}</span> : null}
                        </span>
                        {summaryOf(s) ? (
                            <span className="truncate text-[12px] leading-4 text-colorTextSecondary">
                                {summaryOf(s)}
                            </span>
                        ) : null}
                    </span>
                    <CaretRight size={14} aria-hidden className="shrink-0 text-colorTextTertiary" />
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
                    <h3 className="m-0 flex min-w-0 items-center gap-1.5 text-[15px] font-semibold text-colorText">
                        <span className="truncate">{s.title}</span>
                        <IndicatorDot indicator={s.indicator} />
                        {s.titleBadge ? <span className="shrink-0">{s.titleBadge}</span> : null}
                    </h3>
                    {s.pageAction ? <span className="shrink-0">{s.pageAction}</span> : null}
                </div>
                <div className="overflow-hidden rounded-[10px] border border-solid border-colorBorderSecondary bg-colorBgContainer">
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
                        // Flat rows (they draw a line above themselves; -mt-px tucks the first one
                        // under the card's edge), and no gap between rows inside the lists.
                        <div className="-mt-px flex flex-col [&_*]:gap-y-0">{s.content}</div>
                    )}
                </div>
            </section>
        ))}
    </div>
)
