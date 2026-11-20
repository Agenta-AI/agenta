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
import {CaretRight} from "@phosphor-icons/react"

import {usePhoneSections, type PhoneSectionsApi} from "./phoneSections"

/** One config section, fully resolved by the container. */
export interface AgentTemplateSectionDescriptor {
    key: string
    icon?: ReactNode
    title: ReactNode
    /** Short status pill after the title (see SectionTitleBadge). */
    titleBadge?: ReactNode
    summary?: ReactNode
    /** Header-right slot, before the chevron (the "+" add button). */
    extra?: ReactNode
    indicator?: {tone: SectionIndicatorTone; tooltip?: ReactNode; pulse?: boolean}
    defaultOpen?: boolean
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
    /**
     * Bleed classes for the expanded-header band — must match the host container's padding
     * (the config panel wraps this in `px-4`).
     */
    headerBand?: string
}

export const AgentTemplateSectionList = ({
    sections,
    controlledKeys,
    openByKey,
    onOpenChange,
    emptyText,
    headerBand = "-mx-4 px-4",
}: AgentTemplateSectionListProps) => {
    const t = useT(configItemsCatalog)
    const phoneSections = usePhoneSections()
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
                            // The panel body sits in the config section's `px-4` field wrapper
                            // (PlaygroundConfigSection), so the expanded header's fill bleeds 16px
                            // each side to the panel edges while its text stays aligned with the
                            // content below.
                            headerBand={headerBand}
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

/** A section's title as text, for its header on a phone; the key when the title is not text. */
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
            <div data-config-section={shown.key} className="flex flex-col gap-3 pb-6 pt-3">
                {shown.extra ? <div className="flex justify-end">{shown.extra}</div> : null}
                {shown.content}
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
                            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-colorFillTertiary text-colorTextSecondary"
                        >
                            {s.icon}
                        </span>
                    ) : null}
                    <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[15px] text-colorText">{s.title}</span>
                            {s.indicator ? (
                                <span
                                    aria-hidden
                                    className="size-1.5 shrink-0 rounded-full"
                                    style={{background: sectionIndicatorColor(s.indicator.tone)}}
                                />
                            ) : null}
                            {s.titleBadge ? <span className="shrink-0">{s.titleBadge}</span> : null}
                        </span>
                        {s.summary ? (
                            <span className="truncate text-xs text-colorTextSecondary">
                                {s.summary}
                            </span>
                        ) : null}
                    </span>
                    <CaretRight size={16} aria-hidden className="shrink-0 text-colorTextTertiary" />
                </button>
            ))}
        </div>
    )
}
