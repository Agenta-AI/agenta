/** The schedule drawer's "Version" control: run the latest revision, or pin one. */
import {useMemo, useState} from "react"

import {
    workflowRevisionsListQueryStateAtomFamily,
    workflowVariantsListQueryStateAtomFamily,
} from "@agenta/entities/workflow"
import {dayjs} from "@agenta/shared/utils"
import {
    cn,
    Popover,
    PopoverContent,
    PopoverTrigger,
    selectTriggerVariants,
    Spinner,
} from "@agenta/ui/ui"
import {Check} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import {ChevronDown} from "lucide-react"

import type {ScheduleBinding} from "./useScheduleBinding"

// ---------------------------------------------------------------------------
// VersionField — replaces the workflow→variant→revision cascader for schedules.
// "Latest" persists as `application_variant` (the backend resolves the newest revision on each
// tick); pinning persists as `application_revision`. An app with several variants gets one
// Latest row per variant, with that variant's revisions beneath it — the cascader's third tier
// expressed as grouping rather than another level of drill-in.
// ---------------------------------------------------------------------------

interface RevisionRow {
    id: string
    version?: number | null
    message?: string | null
    created_at?: string | null
}

function versionTag(version?: number | null): string {
    return version == null ? "—" : `v${version}`
}

/** One variant's rows: its Latest option plus every real revision, newest first. */
function VariantGroup({
    variantId,
    variantName,
    showHeader,
    binding,
    onChange,
    onClose,
}: {
    variantId: string
    variantName: string
    showHeader: boolean
    binding: ScheduleBinding
    onChange: (next: ScheduleBinding) => void
    onClose: () => void
}) {
    const revisions = useAtomValue(workflowRevisionsListQueryStateAtomFamily(variantId))

    // Revision 0 is the empty initial commit — never a thing anyone means to schedule.
    const rows = useMemo(
        () =>
            (revisions.data as RevisionRow[])
                .filter((r) => r.version !== 0)
                .sort((a, b) => (b.version ?? 0) - (a.version ?? 0)),
        [revisions.data],
    )
    const newest = rows[0]

    const latestSelected = binding.mode === "latest" && binding.variantId === variantId
    const pick = (next: ScheduleBinding) => {
        onChange(next)
        onClose()
    }

    return (
        <>
            {showHeader ? (
                <span className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ag-colorTextDescription)]">
                    {variantName}
                </span>
            ) : null}

            <button
                type="button"
                onClick={() => pick({...binding, mode: "latest", variantId, revisionId: null})}
                className={`flex w-full items-center justify-between gap-2 rounded-md border-0 px-2.5 py-2 text-left ${
                    latestSelected
                        ? "bg-[var(--ag-colorFillTertiary)]"
                        : "bg-transparent hover:bg-[var(--ag-colorFillQuaternary)]"
                }`}
            >
                <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs font-medium text-[var(--ag-colorText)]">Latest</span>
                    <span className="text-xs text-[var(--ag-colorTextDescription)]">
                        {newest
                            ? `Always runs the newest version — ${versionTag(newest.version)} right now`
                            : "Always runs the newest version"}
                    </span>
                </span>
                {latestSelected ? (
                    <Check size={14} className="shrink-0 text-[var(--ag-colorSuccess)]" />
                ) : null}
            </button>

            {rows.length ? (
                <span className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ag-colorTextDescription)]">
                    Or pin one version
                </span>
            ) : null}

            {rows.map((r) => {
                const selected = binding.mode === "pinned" && binding.revisionId === r.id
                return (
                    <button
                        key={r.id}
                        type="button"
                        onClick={() =>
                            pick({...binding, mode: "pinned", variantId, revisionId: r.id})
                        }
                        className={`flex w-full items-center gap-2 rounded-md border-0 px-2.5 py-1.5 text-left ${
                            selected
                                ? "bg-[var(--ag-colorFillTertiary)]"
                                : "bg-transparent hover:bg-[var(--ag-colorFillQuaternary)]"
                        }`}
                    >
                        <span className="shrink-0 rounded bg-[var(--ag-colorFillTertiary)] px-1.5 py-0.5 font-mono text-xs text-[var(--ag-colorTextSecondary)]">
                            {versionTag(r.version)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-[var(--ag-colorTextSecondary)]">
                            {r.message?.trim() || "No commit message"}
                        </span>
                        <span className="shrink-0 text-xs text-[var(--ag-colorTextDescription)]">
                            {r.created_at ? dayjs(r.created_at).format("MMM D") : ""}
                        </span>
                    </button>
                )
            })}

            {revisions.isPending ? (
                <div className="flex justify-center py-3">
                    <Spinner size="small" />
                </div>
            ) : null}
        </>
    )
}

export function VersionField({
    workflowId,
    binding,
    onChange,
    disabled,
}: {
    workflowId: string | null
    binding: ScheduleBinding
    onChange: (next: ScheduleBinding) => void
    disabled?: boolean
}) {
    const [open, setOpen] = useState(false)
    const variants = useAtomValue(workflowVariantsListQueryStateAtomFamily(workflowId ?? ""))

    const boundVariantId = binding.variantId ?? variants.data[0]?.id ?? ""
    const boundRevisions = useAtomValue(workflowRevisionsListQueryStateAtomFamily(boundVariantId))

    // Trigger label: "Latest — v16 today" or the pinned revision's own tag and message.
    const {label, hint} = useMemo(() => {
        const rows = (boundRevisions.data as RevisionRow[]).filter((r) => r.version !== 0)
        if (binding.mode === "pinned") {
            const pinned = rows.find((r) => r.id === binding.revisionId)
            return {
                label: versionTag(pinned?.version),
                hint: pinned?.message?.trim() ? `— ${pinned.message.trim()}` : "",
            }
        }
        const newest = [...rows].sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0]
        return {label: "Latest", hint: newest ? `— ${versionTag(newest.version)} right now` : ""}
    }, [binding, boundRevisions.data])

    return (
        // `modal`: the content portals to <body>, outside the drawer's scroll lock, which
        // otherwise swallows wheel events and makes the list unscrollable.
        <Popover open={open} onOpenChange={setOpen} modal>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={disabled || !workflowId}
                    className={cn(selectTriggerVariants(), "h-auto py-input-y")}
                >
                    <span className="flex min-w-0 items-baseline gap-2">
                        <span className="text-xs font-medium text-[var(--ag-colorText)]">
                            {label}
                        </span>
                        <span className="min-w-0 truncate text-xs text-[var(--ag-colorTextDescription)]">
                            {hint}
                        </span>
                    </span>
                    <ChevronDown className="size-3 shrink-0 text-placeholder" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="flex max-h-[320px] w-[var(--radix-popover-trigger-width)] flex-col gap-0.5 overflow-y-auto p-1.5"
            >
                {variants.data.length === 0 && !variants.isPending ? (
                    <span className="px-2.5 py-3 text-xs text-[var(--ag-colorTextDescription)]">
                        This agent has no versions yet.
                    </span>
                ) : null}
                {variants.data.map((v) => (
                    <VariantGroup
                        key={v.id}
                        variantId={v.id}
                        variantName={v.name?.trim() || v.slug?.trim() || "Variant"}
                        // A single-variant app needs no grouping header — the common case.
                        showHeader={variants.data.length > 1}
                        binding={binding}
                        onChange={onChange}
                        onClose={() => setOpen(false)}
                    />
                ))}
            </PopoverContent>
        </Popover>
    )
}
