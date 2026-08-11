import {SkeletonBlock} from "@agenta/ui/ui"

/**
 * Loading placeholder for the agent config panel's Configuration section, mirroring its
 * section-row list (Model & harness, Instructions, Tools, MCP servers, Skills, Advanced):
 * leading icon + title on the left, value summary + add/chevron affordances on the right,
 * divider between rows. Shown while the revision/schema is still loading so the panel holds
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
            "flex min-h-[44px] items-center gap-2 overflow-hidden py-3" +
            (divider ? " border-0 border-b border-solid border-[var(--ag-rgba-051729-06)]" : "")
        }
    >
        {/* antd `Skeleton.Avatar size={n}` = an n×n block (square = no radius, circle = 50%);
            `Skeleton.Button size="small"` = a 6px-radius block with antd's controlHeightSM*2
            = 48px MIN-WIDTH, which is why the 44px value bars render 48px wide. */}
        <SkeletonBlock active shape="square" className="h-4 w-4" />
        <SkeletonBlock active className="min-w-12" style={{width: title, height: 16}} />
        <div className="ml-auto flex items-center gap-2">
            <SkeletonBlock active className="min-w-12" style={{width: value, height: 14}} />
            {withAdd ? <SkeletonBlock active shape="circle" className="h-4 w-4" /> : null}
            <SkeletonBlock active shape="circle" className="h-3.5 w-3.5" />
        </div>
    </div>
)

// One entry per section row: title/value widths vary like the real labels do.
const ROWS: {title: number; value: number; withAdd?: boolean}[] = [
    {title: 128, value: 130}, // Model & harness (value mirrors the real, truncating summary)
    {title: 112, value: 48, withAdd: true}, // Instructions
    {title: 60, value: 56, withAdd: true}, // Tools
    {title: 122, value: 44, withAdd: true}, // MCP servers
    {title: 56, value: 44, withAdd: true}, // Skills
    {title: 100, value: 110}, // Advanced
]

const AgentConfigSkeleton = () => (
    // No padding of its own: the surrounding field/fallback wrapper provides the 16px inset.
    // `role="status"`: a bare div is role=generic, which may not carry `aria-label`
    // (axe aria-prohibited-attr) — the live region is also what makes the label useful.
    <div className="flex flex-col" role="status" aria-busy aria-label="Loading agent configuration">
        {ROWS.map((row, i) => (
            <SkeletonSectionRow
                key={i}
                title={row.title}
                value={row.value}
                withAdd={row.withAdd}
                divider={i < ROWS.length - 1}
            />
        ))}
    </div>
)

export default AgentConfigSkeleton
