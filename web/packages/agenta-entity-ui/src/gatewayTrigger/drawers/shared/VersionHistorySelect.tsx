import {useMemo} from "react"

import {workflowRevisionsListDataAtomFamily} from "@agenta/entities/workflow"
import {dayjs} from "@agenta/shared/utils"
import {Check, GitBranch} from "@phosphor-icons/react"
import {Select, Typography} from "antd"
import {useAtomValue} from "jotai"

export interface VersionHistorySelection {
    /** "latest" tracks the newest revision at run time; "revision" pins one point. */
    kind: "latest" | "revision"
    /** Variant id for "latest", revision id for "revision" — the picker's leaf id. */
    id: string
    /** Resolved vN (the newest for "latest"); may be null if unresolved. */
    version: number | null
}

function relativeTime(iso: string | null): string {
    if (!iso) return ""
    const d = dayjs(iso)
    return d.isValid() ? d.fromNow() : ""
}

/**
 * Label for a "Latest" (auto-follow) binding that still shows the concrete version it
 * currently resolves to — "v6 · Latest", falling back to "Latest" if unresolved. Shared by
 * the picker's closed label, the drawer's collapsed summary, and the schedule card chip so
 * all three read the same. Pass the agent's variant id (its revisions are the history).
 */
export function useLatestVersionLabel(variantId: string | null): string {
    const revisions = useAtomValue(workflowRevisionsListDataAtomFamily(variantId ?? ""))
    const newest = revisions.find((r) => (r as {version?: number | null}).version !== 0) as
        | {version?: number | null}
        | undefined
    const version = newest?.version
    return version != null ? `v${version} · Latest` : "Latest"
}

/**
 * Agent "History" version picker for the trigger drawers — a flat revision list matching
 * the agent playground's History dropdown (PR #5273): a `vN` badge, the commit message,
 * a relative time, a "Latest" tag on the newest, and a check on the selected row.
 *
 * The newest row IS "Latest": picking it binds the variant (auto-follows future commits),
 * so its closed label reads "Latest"; picking any older row pins that exact revision (vN).
 * Purely presentational — the drawer owns the bound id and maps the selection into its
 * reference family. Used only in the agent playground (a known variant); the settings /
 * evaluator flows keep the full workflow → variant → revision EntityPicker untouched.
 */
export function VersionHistorySelect({
    variantId,
    value,
    onSelect,
    placeholder = "Select a version",
    disabled,
}: {
    /** The agent's variant id — its revisions are the history. */
    variantId: string | null
    /** Current leaf id: the variant id (= Latest) or a revision id (= that vN). */
    value: string | null
    onSelect: (selection: VersionHistorySelection) => void
    placeholder?: string
    disabled?: boolean
}) {
    const revisions = useAtomValue(workflowRevisionsListDataAtomFamily(variantId ?? ""))

    // Newest-first, drop the empty v0 (initial revision) — same as the pickers elsewhere.
    const versioned = useMemo(
        () =>
            revisions
                .map((r) => ({
                    id: (r as {id: string}).id,
                    version: (r as {version?: number | null}).version ?? null,
                    message: (r as {message?: string | null}).message ?? null,
                    createdAt: (r as {created_at?: string | null}).created_at ?? null,
                }))
                .filter((r) => r.version !== 0 && !!r.id),
        [revisions],
    )

    const newestId = versioned[0]?.id ?? null
    // A latest (variant) binding stores the variant id as its leaf; a pinned binding stores
    // the revision id. Latest highlights the newest row (which carries the "Latest" tag).
    const isLatest = value != null && value === variantId
    const selectedValue = value == null ? undefined : isLatest ? (newestId ?? undefined) : value
    const latestLabel = useLatestVersionLabel(variantId)

    const options = useMemo(
        () =>
            versioned.map((r) => ({
                value: r.id,
                label: `v${r.version}`,
                title: `v${r.version}`,
                version: r.version,
                message: r.message?.trim() || "",
                createdAt: r.createdAt,
                isNewest: r.id === versioned[0]?.id,
            })),
        [versioned],
    )

    return (
        <Select<string>
            className="w-full max-w-prose"
            placeholder={placeholder}
            value={selectedValue}
            disabled={disabled}
            options={options}
            optionLabelProp="label"
            listHeight={288}
            popupMatchSelectWidth={false}
            menuItemSelectedIcon={null}
            onChange={(next) => {
                // The newest row means "Latest" — bind the variant so the trigger auto-follows.
                if (next === newestId && variantId) {
                    onSelect({
                        kind: "latest",
                        id: variantId,
                        version: versioned[0]?.version ?? null,
                    })
                    return
                }
                const rev = versioned.find((r) => r.id === next)
                onSelect({kind: "revision", id: next, version: rev?.version ?? null})
            }}
            // Two-line row (matches the playground History dropdown): a [vN] badge with the
            // Latest tag / relative time / ✓ on the top line, and the commit message below.
            optionRender={(option) => {
                const data = option.data as {
                    version?: number | null
                    message?: string
                    createdAt?: string | null
                    isNewest?: boolean
                }
                const isSelected = option.value === selectedValue
                return (
                    <div className="flex min-w-[360px] flex-col gap-1 py-1.5">
                        <div className="flex items-center gap-2">
                            <span className="flex h-6 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--ag-colorFillSecondary)] font-medium text-[var(--ag-colorText)]">
                                v{data.version}
                            </span>
                            <span className="flex-1" />
                            {data.isNewest ? (
                                <span className="shrink-0 text-[11px] font-medium text-[var(--ag-colorText)]">
                                    Latest
                                </span>
                            ) : null}
                            <span className="shrink-0 text-[11px] text-[var(--ag-colorTextTertiary)]">
                                {relativeTime(data.createdAt ?? null)}
                            </span>
                            {isSelected ? (
                                <Check
                                    size={14}
                                    weight="bold"
                                    className="shrink-0 text-[var(--ag-colorPrimary)]"
                                />
                            ) : null}
                        </div>
                        <span
                            className={`truncate ${
                                data.message
                                    ? "text-[var(--ag-colorTextSecondary)]"
                                    : "italic text-[var(--ag-colorTextTertiary)]"
                            }`}
                        >
                            {data.message || "No commit message"}
                        </span>
                    </div>
                )
            }}
            // Closed trigger: history icon + "v{newest} · Latest" (variant binding) or the
            // pinned vN — the version stays visible even when auto-following the latest.
            labelRender={(props) => (
                <span className="flex items-center gap-1.5">
                    <GitBranch size={13} className="text-[var(--ag-colorTextSecondary)]" />
                    {isLatest ? latestLabel : ((props.label as string) ?? props.value)}
                </span>
            )}
            notFoundContent={
                <Typography.Text type="secondary" className="!text-[11px]">
                    No versions yet.
                </Typography.Text>
            }
        />
    )
}
