import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import {SkeletonBlock} from "@agenta/ui/ui"

import {usePhoneSections} from "./phoneSections"
import {useSectionListLayout} from "./sectionListLayout"

/**
 * Loading placeholder for the agent's sections, in the shape of each layout: the panel's cards,
 * the page's titled cards, and divided rows for the phone. Shown while the revision/schema is still loading so the panel holds
 * its real shape instead of the generic prompt-config pulse boxes. Triggers/Mounts are NOT
 * config sections — their loading shape is `AgentOperationsSkeleton` (sibling regions).
 */

/** One pulsing section row (icon + title + value + affordances) — shared with the ops skeleton. */
export const SkeletonSectionRow = ({
    title,
    value,
    withAdd,
    divider,
}: {
    title: number
    value: number
    withAdd?: boolean
    divider?: boolean
}) => (
    <div
        className={
            // Mirror the real ConfigAccordionSection header row exactly: `gap-2`, a 16px leading
            // icon, title + summary + chevron, and the same 44px text-driven header height (min-h
            // pins it so the 16px placeholders don't collapse the row) — a divider row then totals
            // 45px like a real bordered section, and the last (no-divider) row is 44px like Advanced.
            "flex min-h-11 items-center gap-2 overflow-hidden py-3" +
            (divider ? " border-0 border-b border-solid border-border-muted" : "")
        }
    >
        {/* antd `Skeleton.Avatar size={n}` = an n×n block (square = no radius, circle = 50%);
            `Skeleton.Button size="small"` = a 6px-radius block with antd's controlHeightSM*2
            = 48px MIN-WIDTH, which is why the 44px value bars render 48px wide. */}
        <SkeletonBlock active shape="square" className="h-4 w-4" />
        <SkeletonBlock active className="min-w-12" style={{width: title, height: 16}} />
        <div className="ml-auto flex items-center gap-2">
            <SkeletonBlock active className="min-w-12" style={{width: value, height: 14}} />
            {withAdd ? <SkeletonBlock active shape="mark" className="h-4 w-4" /> : null}
            <SkeletonBlock active shape="mark" className="h-3.5 w-3.5" />
        </div>
    </div>
)

// One entry per section row: title/value widths vary like the real labels do.
const ROWS: {title: number; value: number; withAdd?: boolean}[] = [
    {title: 128, value: 130}, // Model (value mirrors the real, truncating summary)
    {title: 112, value: 48, withAdd: true}, // Instructions
    {title: 60, value: 56, withAdd: true}, // Tools
    {title: 122, value: 44, withAdd: true}, // MCP servers
    {title: 56, value: 44, withAdd: true}, // Skills
    {title: 100, value: 110}, // Advanced
]

/** The Configuration page's shape (canvas A04): a title and its action over one card per section. */
const PageSkeleton = () => (
    <div className="flex flex-col gap-7">
        {ROWS.map((row, i) => (
            <div key={i} className="flex flex-col gap-2">
                <div className="flex min-h-7 items-center justify-between">
                    <SkeletonBlock active style={{width: row.title, height: 16}} />
                    <SkeletonBlock active className="h-7 w-14" />
                </div>
                <div className="flex h-14 items-center gap-3 rounded-lg border border-solid border-border-muted px-3.5">
                    <SkeletonBlock active shape="square" className="h-7 w-7" />
                    <SkeletonBlock active style={{width: row.value + 80, height: 14}} />
                </div>
            </div>
        ))}
    </div>
)

// The panel's cards (canvas F01) in their order; `add` marks a section with a "+" in its header.
const CARDS: {title: number; value?: number; add?: boolean; preview?: boolean}[] = [
    {title: 44, value: 84}, // Model
    {title: 84, value: 64, preview: true}, // Instructions
    {title: 88, value: 72, add: true}, // Integrations
    {title: 76, value: 72, add: true}, // Subagents
    {title: 88, value: 60, add: true}, // MCP servers
    {title: 40, value: 52, add: true}, // Skills
    {title: 68}, // Advanced
]

/** The panel: one muted card per section, a 40 px header with a white 28 px Mark (STATE-02). */
const PanelSkeleton = () => (
    <div className="flex flex-col gap-2 pt-3">
        {CARDS.map((card, i) => (
            <div key={i} className="-mx-2.5 flex flex-col rounded-lg bg-muted">
                <div className="flex h-10 items-center gap-2 px-2.5">
                    <span className="size-7 shrink-0 rounded-md bg-background" />
                    <SkeletonBlock active style={{width: card.title, height: 14}} />
                    <div className="ml-auto flex items-center gap-2">
                        {card.value ? (
                            <SkeletonBlock active style={{width: card.value, height: 12}} />
                        ) : null}
                        {card.add ? <SkeletonBlock active className="size-3.5" /> : null}
                        <SkeletonBlock active className="size-3.5" />
                    </div>
                </div>
                {card.preview ? (
                    <div className="-mt-0.5 flex flex-col gap-1.5 pb-2.5 pl-11.5 pr-2.5">
                        <SkeletonBlock active className="h-3 w-full" />
                        <SkeletonBlock active className="h-3 w-full" />
                        <SkeletonBlock active className="h-3 w-2/3" />
                    </div>
                ) : null}
            </div>
        ))}
    </div>
)

const AgentConfigSkeleton = () => {
    const t = useT(configItemsCatalog)
    const layout = useSectionListLayout()
    const phone = usePhoneSections() !== null
    return (
        // No padding of its own: the surrounding field/fallback wrapper provides the 16px inset.
        // `role="status"`: a bare div is role=generic, which may not carry `aria-label`
        // (axe aria-prohibited-attr) — the live region is also what makes the label useful.
        <div
            className="flex flex-col"
            role="status"
            aria-busy
            aria-label={t("entityUi.configItems.loadingAgentConfig")}
        >
            {layout === "page" ? (
                <PageSkeleton />
            ) : phone ? (
                ROWS.map((row, i) => (
                    <SkeletonSectionRow
                        key={i}
                        title={row.title}
                        value={row.value}
                        withAdd={row.withAdd}
                        divider={i < ROWS.length - 1}
                    />
                ))
            ) : (
                <PanelSkeleton />
            )}
        </div>
    )
}

export default AgentConfigSkeleton
