import {Skeleton} from "antd"

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
            "flex items-center gap-3 overflow-hidden py-6" +
            (divider ? " border-0 border-b border-solid border-[var(--ag-rgba-051729-06)]" : "")
        }
    >
        <Skeleton.Avatar active size={22} shape="square" />
        <Skeleton.Button active size="small" style={{width: title, height: 16}} />
        <div className="ml-auto flex items-center gap-3">
            <Skeleton.Button active size="small" style={{width: value, height: 14}} />
            {withAdd ? <Skeleton.Avatar active size={16} shape="circle" /> : null}
            <Skeleton.Avatar active size={14} shape="circle" />
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
    <div className="flex flex-col" aria-busy aria-label="Loading agent configuration">
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
