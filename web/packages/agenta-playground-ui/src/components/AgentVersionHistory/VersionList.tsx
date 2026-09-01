/**
 * The drawer's left rail: every version of the agent, newest first.
 *
 * Four states, all drawn in the design: loading, load error (retryable), a single version
 * (nothing to compare yet), and the list.
 */
import type {AgentVersionRow} from "@agenta/playground/state"
import {timeAgo} from "@agenta/shared/utils"
import {cn, textColors} from "@agenta/ui/styles"
import {Button} from "@agenta/ui/ui"

const SKELETON_ROWS = [
    {title: "38%", body: "88%"},
    {title: "32%", body: "70%"},
    {title: "40%", body: "78%"},
    {title: "30%", body: "56%"},
]

const Pulse = ({width, tone}: {width: string; tone: "strong" | "faint"}) => (
    <div
        className={cn(
            "h-3 animate-pulse rounded-[3px]",
            tone === "strong"
                ? "bg-[var(--ag-colorFillSecondary)]"
                : "h-2.5 bg-[var(--ag-colorFillTertiary)]",
        )}
        style={{width}}
    />
)

const Notice = ({title, body, action}: {title: string; body: string; action?: React.ReactNode}) => (
    <div className="px-3 py-6 text-center">
        <div className="mb-1 text-xs font-semibold text-colorText">{title}</div>
        <p className={cn("mb-3 text-[11.5px] leading-relaxed", textColors.tertiary)}>{body}</p>
        {action}
    </div>
)

export interface VersionListProps {
    rows: AgentVersionRow[]
    selectedId: string | null
    isLoading: boolean
    isError: boolean
    onRetry: () => void
    onSelect: (revisionId: string) => void
    /** Rendered per row where the host can pin a revision (mobile). Omitted, rows only select. */
    renderRowAction?: (row: AgentVersionRow) => React.ReactNode
}

export const VersionList = ({
    rows,
    selectedId,
    isLoading,
    isError,
    onRetry,
    onSelect,
    renderRowAction,
}: VersionListProps) => (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {isLoading ? (
            <>
                {SKELETON_ROWS.map((row, i) => (
                    <div key={i} className="flex flex-col gap-1.5 px-2.5 py-2.5">
                        <Pulse width={row.title} tone="strong" />
                        <Pulse width={row.body} tone="faint" />
                    </div>
                ))}
            </>
        ) : isError ? (
            <Notice
                title="Couldn't load versions"
                body="The request failed. Nothing was changed."
                action={
                    <Button variant="outline" size="sm" onClick={onRetry}>
                        Retry
                    </Button>
                }
            />
        ) : rows.length === 0 ? (
            <Notice
                title="No versions yet"
                body="This agent has nothing committed to compare or restore."
            />
        ) : rows.length === 1 ? (
            <Notice
                title="Only one version"
                body={`v${rows[0].version} is the first commit, so there is nothing to compare or restore yet.`}
            />
        ) : (
            rows.map((row) => (
                // Row action sits beside the select button, never inside it: nested interactive
                // elements are invalid and swallow the inner click.
                <div
                    key={row.id}
                    className={cn(
                        "mb-px flex items-center gap-1 rounded-md",
                        row.id === selectedId
                            ? "bg-[var(--ag-colorFillSecondary)]"
                            : !row.isCurrent && "hover:bg-[var(--ag-colorFillQuaternary)]",
                    )}
                >
                    {/* The latest version IS the current configuration, so selecting it could
                        only ever diff against itself. It stays listed, not selectable. */}
                    <button
                        type="button"
                        disabled={row.isCurrent}
                        aria-current={row.id === selectedId}
                        onClick={() => onSelect(row.id)}
                        className={cn(
                            "flex min-w-0 flex-1 flex-col gap-1 rounded-md border-0 bg-transparent px-2.5 py-2 text-left font-[inherit]",
                            // Dimmed so the row READS unselectable, not just behaves that way.
                            row.isCurrent ? "cursor-default opacity-55" : "cursor-pointer",
                        )}
                    >
                        <span className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-colorText">
                                v{row.version}
                            </span>
                            {row.isCurrent ? (
                                <span className="rounded px-1.5 py-px text-[10px] font-medium text-[var(--ag-colorInfo)] bg-[var(--ag-colorInfoBg)]">
                                    Latest
                                </span>
                            ) : null}
                            {row.isReverted && !row.isCurrent ? (
                                <span
                                    className={cn(
                                        "rounded bg-[var(--ag-colorFillSecondary)] px-1.5 py-px text-[10px] font-medium",
                                        textColors.secondary,
                                    )}
                                >
                                    Reverted
                                </span>
                            ) : null}
                            <span
                                className={cn(
                                    "ml-auto whitespace-nowrap text-[10.5px]",
                                    textColors.tertiary,
                                )}
                            >
                                {row.createdAt ? timeAgo(Date.parse(row.createdAt)) : ""}
                            </span>
                        </span>
                        <span
                            className={cn(
                                "line-clamp-2 text-xs leading-snug",
                                textColors.secondary,
                            )}
                        >
                            {row.message || "No commit message"}
                        </span>
                    </button>
                    {renderRowAction ? (
                        <span className="shrink-0 pr-1.5">{renderRowAction(row)}</span>
                    ) : null}
                </div>
            ))
        )}
    </div>
)
