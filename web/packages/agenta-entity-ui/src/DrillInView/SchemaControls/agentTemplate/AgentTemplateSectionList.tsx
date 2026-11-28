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
import {useContext, useState, type AnimationEvent, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import {
    ConfigAccordionSection,
    sectionIndicatorColor,
    type SectionIndicatorTone,
} from "@agenta/ui/components/presentational"
import {PhonePrimaryAction} from "@agenta/ui/phone"
import {cn} from "@agenta/ui/styles"
import {viewEnterClass, type ViewDirection} from "@agenta/ui/view-stack"
import {CaretRight} from "@phosphor-icons/react"

import {CanvasGroupHeader} from "./CanvasGroupHeader"
import {usePhoneSections, type PhoneSectionsApi} from "./phoneSections"
import {SectionEmptyActionContext, type SectionEmptyAction} from "./SectionEmpty"
import {CONFIG_SECTION_GROUPS, ConfigSectionGroupsContext, groupOfSection} from "./sectionGroups"

/** One config section, fully resolved by the container. */
export interface AgentTemplateSectionDescriptor {
    key: string
    icon?: ReactNode
    title: ReactNode
    /** Short status pill after the title (see SectionTitleBadge). */
    titleBadge?: ReactNode
    summary?: ReactNode
    /** The section holds nothing: the panel row shows no summary (F01, F02); the phone keeps "None". */
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
     * In the panel, the section is one card that opens a view, with a preview under its title
     * (Instructions). The phone keeps `content`.
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
    const grouped = useContext(ConfigSectionGroupsContext)
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

    if (phoneSections)
        return (
            <PhoneSectionList sections={sections} phoneSections={phoneSections} grouped={grouped} />
        )

    const renderSection = (s: AgentTemplateSectionDescriptor) => {
        const controlled = Boolean(controlledKeys?.has(s.key))
        const card = s.panelCard
        return (
            // An anchor per section (the builder's section marks find it).
            <div key={s.key} data-config-section={s.key}>
                <ConfigAccordionSection
                    icon={s.icon}
                    title={s.title}
                    titleBadge={card?.badge ?? s.titleBadge}
                    summary={
                        card ? card.summary : s.empty ? undefined : s.panelSummary || s.summary
                    }
                    preview={card?.preview}
                    extra={s.extra}
                    indicator={s.indicator}
                    onOpen={card?.onOpen ?? s.onOpen}
                    drawerAffordance={s.drawerAffordance}
                    highlight={s.highlight}
                    bodyClassName={s.bodyClassName ?? (s.insetBody ? PANEL_INSET_BODY : PANEL_BODY)}
                    // Canvas F01: rows inset in the panel's `px-4`.
                    canvas="panel"
                    // The panel's section cards sit 8 px apart, with no dividers.
                    noDivider
                    // The section icon sits on the same Mark as its item rows.
                    iconTile
                    {...(controlled
                        ? {
                              open: openByKey?.[s.key] ?? s.defaultOpen ?? false,
                              onOpenChange: (open: boolean) => onOpenChange?.(s.key, open),
                          }
                        : {defaultOpen: s.defaultOpen, animateInitialOpen: true})}
                >
                    <SectionEmptyActionContext.Provider value={s.emptyAction ?? null}>
                        {s.content}
                    </SectionEmptyActionContext.Provider>
                </ConfigAccordionSection>
            </div>
        )
    }

    if (grouped) {
        // The Configuration page: a titled group per part, 8 px between its cards and 12 px more
        // above the next group's title (SPACE-01).
        return (
            <div className="flex flex-col gap-3">
                {CONFIG_SECTION_GROUPS.map((group) => {
                    const members = sections.filter((s) => groupOfSection(s.key) === group)
                    if (members.length === 0) return null
                    return (
                        <section key={group} className="flex flex-col gap-2">
                            <CanvasGroupHeader label={t(GROUP_TITLE_KEY[group])} />
                            {members.map(renderSection)}
                        </section>
                    )
                })}
            </div>
        )
    }

    return (
        // Canvas F01.
        <div className="flex flex-col gap-2 pt-3">{sections.map(renderSection)}</div>
    )
}

const GROUP_TITLE_KEY = {
    setup: "entityUi.configItems.groupSetup",
    uses: "entityUi.configItems.groupUses",
    more: "entityUi.configItems.groupMore",
} as const

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

/** A section's title as text, for its header on a phone; the key otherwise. */
const sectionTitle = (s: AgentTemplateSectionDescriptor) =>
    typeof s.title === "string" ? s.title : s.key

/**
 * The sections on a phone: one row per section with its current value, or the open section as its
 * own screen (the container draws its header). A section that opens a view opens it from its row.
 */
const PhoneSectionList = ({
    sections,
    phoneSections,
    grouped,
}: {
    sections: AgentTemplateSectionDescriptor[]
    phoneSections: PhoneSectionsApi
    /** The Configuration page: the rows under their group titles. */
    grouped: boolean
}) => {
    const t = useT(configItemsCatalog)
    const shown = sections.find((s) => s.key === phoneSections.shownKey && !s.onOpen)
    // A section opens and closes with the view motion; the header the container draws stays still.
    const shownKey = shown?.key ?? null
    const [last, setLast] = useState<{key: string | null; dir: ViewDirection | null}>({
        key: shownKey,
        dir: null,
    })
    let dir = last.dir
    if (last.key !== shownKey) {
        dir = shownKey ? "forward" : "back"
        setLast({key: shownKey, dir})
    }
    // Played once: a later display change (a view closing over it) must not replay it.
    const settle = (event: AnimationEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) setLast((prev) => ({...prev, dir: null}))
    }
    if (shown) {
        return (
            <div
                data-config-section={shown.key}
                // With a primary action the column fills its container's height (the phone
                // container is a size container), so the action sits at the bottom of the screen;
                // -mb-3 takes back the host's bottom padding, so a short list does not scroll.
                className={cn(
                    "flex flex-col gap-3 pt-3",
                    shown.phoneAction ? "-mb-3 min-h-[100cqh]" : "pb-6",
                    viewEnterClass(dir),
                )}
                onAnimationEnd={settle}
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
    const renderRow = (s: AgentTemplateSectionDescriptor) => (
        <button
            key={s.key}
            type="button"
            data-config-section={s.key}
            className="flex min-h-row-double w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-2 py-1 text-left font-[inherit] hover:bg-accent active:bg-accent"
            onClick={() => (s.onOpen ? s.onOpen() : phoneSections.show(s.key, sectionTitle(s)))}
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
                    <span className="truncate text-body leading-5 text-foreground">{s.title}</span>
                    <IndicatorDot indicator={s.indicator} />
                    {s.titleBadge ? <span className="shrink-0">{s.titleBadge}</span> : null}
                </span>
                {summaryOf(s) ? (
                    <span className="truncate text-meta text-muted-foreground">{summaryOf(s)}</span>
                ) : null}
            </span>
            <CaretRight size={14} aria-hidden className="shrink-0 text-muted-foreground" />
        </button>
    )
    return (
        // Two-line rows 8 px apart, no dividers (ROW-04, SURF-01); each row hangs its hover fill
        // 8 px out, so its Mark stays on the screen's content line (ALIGN-01).
        <div
            className={cn("-mx-2 flex flex-col gap-2", viewEnterClass(dir))}
            data-testid="phone-section-list"
            onAnimationEnd={settle}
        >
            {grouped
                ? CONFIG_SECTION_GROUPS.map((group) => {
                      const members = sections.filter((s) => groupOfSection(s.key) === group)
                      if (members.length === 0) return null
                      return (
                          // The title sits on the content line, inside the rows' 8 px bleed.
                          <section key={group} className="flex flex-col gap-2">
                              <div className="px-2">
                                  <CanvasGroupHeader label={t(GROUP_TITLE_KEY[group])} />
                              </div>
                              {members.map(renderRow)}
                          </section>
                      )
                  })
                : sections.map(renderRow)}
        </div>
    )
}
