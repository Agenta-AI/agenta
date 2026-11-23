/**
 * The drawer's left rail: every version of the agent, newest first.
 *
 * Three states: loading, load error (retryable), and the list. Every version is selectable —
 * each one is diffed against its predecessor, so the newest has something to show too.
 */
import {formatRelativeTime, useT} from "@agenta/i18n"
import versionCatalog from "@agenta/i18n/catalogs/playground.versionHistory"
import type {AgentVersionRow} from "@agenta/playground/state"
import {cn, textColors} from "@agenta/ui/styles"
import {Button} from "@agenta/ui/ui"

/** A version's age in words, as the canvas writes it (S06): "2 hours ago", "1 day ago". */
const versionAge = (iso: string): string => {
    const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
    const long = {style: "long", numeric: "always"} as const
    if (seconds < 60) return formatRelativeTime(0, "second", {style: "long", numeric: "auto"})
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return formatRelativeTime(-minutes, "minute", long)
    const hours = Math.round(minutes / 60)
    if (hours < 24) return formatRelativeTime(-hours, "hour", long)
    return formatRelativeTime(-Math.round(hours / 24), "day", long)
}

const SKELETON_ROWS = [
    {title: "38%", body: "88%"},
    {title: "32%", body: "70%"},
    {title: "40%", body: "78%"},
    {title: "30%", body: "56%"},
]

const Pulse = ({width, tone}: {width: string; tone: "strong" | "faint"}) => (
    <div
        className={cn(
            "h-3 animate-pulse rounded-sm",
            tone === "strong"
                ? "bg-secondary"
                : "h-2.5 bg-secondary",
        )}
        style={{width}}
    />
)

const Notice = ({title, body, action}: {title: string; body: string; action?: React.ReactNode}) => (
    <div className="px-3 py-6 text-center">
        <div className="mb-1 text-label font-semibold text-foreground">{title}</div>
        <p className={cn("mb-3 text-caption leading-relaxed", textColors.tertiary)}>{body}</p>
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
    /** Freeze selection while a revert is in flight. */
    disabled?: boolean
}

export const VersionList = ({
    rows,
    selectedId,
    isLoading,
    isError,
    onRetry,
    onSelect,
    disabled,
}: VersionListProps) => {
    const t = useT(versionCatalog)
    return (
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
                    title={t("playground.versionHistory.couldNotLoadVersions")}
                    body={t("playground.versionHistory.requestFailed")}
                    action={
                        <Button variant="outline" size="sm" onClick={onRetry}>
                            {t("playground.versionHistory.retry")}
                        </Button>
                    }
                />
            ) : rows.length === 0 ? (
                <Notice
                    title={t("playground.versionHistory.noVersions")}
                    body={t("playground.versionHistory.noVersionsBody")}
                />
            ) : (
                rows.map((row) => (
                    <div
                        key={row.id}
                        className={cn(
                            "mb-px flex items-center gap-1 rounded-md",
                            row.id === selectedId
                                ? "bg-secondary"
                                : "hover:bg-accent",
                        )}
                    >
                        <button
                            type="button"
                            disabled={!!disabled}
                            aria-current={row.id === selectedId}
                            onClick={() => onSelect(row.id)}
                            className={cn(
                                "flex min-w-0 flex-1 flex-col gap-1 rounded-md border-0 bg-transparent px-2.5 py-2 text-left font-[inherit]",
                                disabled ? "cursor-default" : "cursor-pointer",
                            )}
                        >
                            <span className="flex items-center gap-1.5">
                                <span className="text-meta font-medium text-foreground">
                                    v{row.version}
                                </span>
                                {/* One tag, one meaning: the newest revision. */}
                                {row.isLatest ? (
                                    <span className="rounded bg-info/10 px-1.5 py-px text-caption font-medium text-info">
                                        {t("playground.versionHistory.latest")}
                                    </span>
                                ) : null}
                                <span
                                    className={cn(
                                        "ml-auto whitespace-nowrap text-caption",
                                        textColors.tertiary,
                                    )}
                                >
                                    {row.createdAt ? versionAge(row.createdAt) : ""}
                                </span>
                            </span>
                            <span
                                className={cn(
                                    "line-clamp-2 text-meta",
                                    textColors.secondary,
                                )}
                            >
                                {row.message || t("playground.versionHistory.noCommitMessage")}
                            </span>
                        </button>
                    </div>
                ))
            )}
        </div>
    )
}
