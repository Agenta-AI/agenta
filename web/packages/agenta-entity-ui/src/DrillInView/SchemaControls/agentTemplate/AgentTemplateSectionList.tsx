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

import {
    ConfigAccordionSection,
    type SectionIndicatorTone,
} from "@agenta/ui/components/presentational"

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
    emptyText = "No agent configuration fields are available for this schema.",
    headerBand = "-mx-4 px-4",
}: AgentTemplateSectionListProps) => {
    if (sections.length === 0) {
        // antd `Typography.Text type="secondary"` = colorTextDescription + `word-break: break-word`.
        // Its line-height token does NOT apply here: the call site already carried `text-xs`, and
        // the Tailwind sheet is injected after antd's cssinjs, so 16px is what antd rendered.
        return <span className="break-words text-xs text-colorTextDescription">{emptyText}</span>
    }

    return (
        <>
            {sections.map((s, index) => {
                const controlled = Boolean(controlledKeys?.has(s.key))
                return (
                    <ConfigAccordionSection
                        key={s.key}
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
                )
            })}
        </>
    )
}
