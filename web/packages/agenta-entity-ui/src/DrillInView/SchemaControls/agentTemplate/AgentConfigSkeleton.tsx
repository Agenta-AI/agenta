import {Skeleton} from "antd"

/**
 * Loading placeholder for the agent config panel, mirroring its section-row list
 * (Model & harness, Instructions, Tools, MCP servers, Skills, Triggers, Advanced):
 * leading icon + title on the left, value summary + add/chevron affordances on the
 * right, divider between rows. Shown while the revision/schema is still loading so
 * the panel holds its real shape instead of the generic prompt-config pulse boxes.
 */

// One entry per section row: title/value widths vary like the real labels do.
const ROWS: {title: number; value: number; withAdd?: boolean}[] = [
    {title: 128, value: 130}, // Model & harness (value mirrors the real, truncating summary)
    {title: 112, value: 48, withAdd: true}, // Instructions
    {title: 60, value: 56, withAdd: true}, // Tools
    {title: 122, value: 44, withAdd: true}, // MCP servers
    {title: 56, value: 44, withAdd: true}, // Skills
    {title: 82, value: 44, withAdd: true}, // Triggers
    {title: 100, value: 110}, // Advanced
]

const AgentConfigSkeleton = () => (
    // No padding of its own: the surrounding field/fallback wrapper provides the 16px inset.
    <div className="flex flex-col" aria-busy aria-label="Loading agent configuration">
        {ROWS.map((row, i) => (
            <div
                key={i}
                className={
                    "flex items-center gap-3 overflow-hidden py-6" +
                    (i < ROWS.length - 1
                        ? " border-0 border-b border-solid border-[var(--ag-rgba-051729-06)]"
                        : "")
                }
            >
                <Skeleton.Avatar active size={22} shape="square" />
                <Skeleton.Button active size="small" style={{width: row.title, height: 16}} />
                <div className="ml-auto flex items-center gap-3">
                    <Skeleton.Button active size="small" style={{width: row.value, height: 14}} />
                    {row.withAdd ? <Skeleton.Avatar active size={16} shape="circle" /> : null}
                    <Skeleton.Avatar active size={14} shape="circle" />
                </div>
            </div>
        ))}
    </div>
)

export default AgentConfigSkeleton
