/** The trigger drawers' "Version" control: run the latest revision, or pin one. */
import {useMemo} from "react"

import {
    workflowRevisionsListQueryStateAtomFamily,
    workflowVariantsListQueryStateAtomFamily,
} from "@agenta/entities/workflow"
import {dayjs} from "@agenta/shared/utils"
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
    Spinner,
} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {useBoundRevision, type TriggerBinding} from "./useTriggerBinding"

// ---------------------------------------------------------------------------
// VersionField — replaces the workflow→variant→revision cascader in the trigger drawers.
// "Latest" persists as `application_variant` (the backend resolves the newest revision on each
// run); pinning persists as `application_revision`. An app with several variants gets one
// Latest option per variant, with that variant's revisions beneath it — the cascader's third
// tier expressed as grouping rather than another level of drill-in.
//
// A real Select, not a Popover of buttons: dismissal, keyboard navigation and scrolling inside
// a modal drawer are Radix's problem then, not ours.
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

/** Both choices encoded as Select values; ids are UUIDs, so `:` is a safe separator. */
const latestValue = (variantId: string) => `latest:${variantId}`
const pinnedValue = (variantId: string, revisionId: string) => `rev:${variantId}:${revisionId}`

function parseValue(value: string, workflowId: string | null): TriggerBinding | null {
    const [kind, variantId, revisionId] = value.split(":")
    if (!variantId) return null
    if (kind === "rev" && revisionId) {
        return {mode: "pinned", workflowId, variantId, revisionId}
    }
    if (kind === "latest") return {mode: "latest", workflowId, variantId, revisionId: null}
    return null
}

/** One variant's options: its Latest entry plus every real revision, newest first. */
function VariantOptions({
    variantId,
    variantName,
    showHeader,
}: {
    variantId: string
    variantName: string
    showHeader: boolean
}) {
    const revisions = useAtomValue(workflowRevisionsListQueryStateAtomFamily(variantId))

    // Revision 0 is the empty initial commit — never a thing anyone means to run.
    const rows = useMemo(
        () =>
            (revisions.data as RevisionRow[])
                .filter((r) => r.version !== 0)
                .sort((a, b) => (b.version ?? 0) - (a.version ?? 0)),
        [revisions.data],
    )
    const newest = rows[0]

    return (
        <SelectGroup>
            {showHeader ? <SelectLabel>{variantName}</SelectLabel> : null}

            <SelectItem value={latestValue(variantId)}>
                <span className="flex min-w-0 flex-col gap-0.5 text-left">
                    <span className="text-xs font-medium text-[var(--ag-colorText)]">Latest</span>
                    <span className="text-xs font-normal text-[var(--ag-colorTextDescription)]">
                        {newest
                            ? `Always runs the newest version — ${versionTag(newest.version)} right now`
                            : "Always runs the newest version"}
                    </span>
                </span>
            </SelectItem>

            {rows.length ? <SelectLabel>Or pin one version</SelectLabel> : null}

            {rows.map((r) => (
                <SelectItem key={r.id} value={pinnedValue(variantId, r.id)}>
                    <span className="flex min-w-0 items-center gap-2 text-left">
                        <span className="shrink-0 rounded bg-[var(--ag-colorFillTertiary)] px-1.5 py-0.5 font-mono text-xs font-normal text-[var(--ag-colorTextSecondary)]">
                            {versionTag(r.version)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs font-normal text-[var(--ag-colorTextSecondary)]">
                            {r.message?.trim() || "No commit message"}
                        </span>
                        <span className="shrink-0 text-xs font-normal text-[var(--ag-colorTextDescription)]">
                            {r.created_at ? dayjs(r.created_at).format("MMM D") : ""}
                        </span>
                    </span>
                </SelectItem>
            ))}

            {revisions.isPending ? (
                <div className="flex justify-center py-3">
                    <Spinner size="small" />
                </div>
            ) : null}
        </SelectGroup>
    )
}

export function VersionField({
    workflowId,
    binding,
    onChange,
    disabled,
}: {
    workflowId: string | null
    binding: TriggerBinding
    onChange: (next: TriggerBinding) => void
    disabled?: boolean
}) {
    const variants = useAtomValue(workflowVariantsListQueryStateAtomFamily(workflowId ?? ""))

    const boundVariantId = binding.variantId ?? variants.data[0]?.id ?? ""
    // Same resolution the composer and the drift tag use — an app with one variant binds it
    // implicitly, so the effective variant is passed rather than the binding's own.
    const bound = useBoundRevision({...binding, variantId: boundVariantId})

    const value =
        binding.mode === "pinned" && binding.revisionId
            ? pinnedValue(boundVariantId, binding.revisionId)
            : boundVariantId
              ? latestValue(boundVariantId)
              : undefined

    // Trigger label: "Latest — v16 right now" or the pinned revision's own tag and message.
    // Rendered as SelectValue children so the compact one-line label stays independent of the
    // two-line rows in the list.
    const {label, hint} = useMemo(() => {
        if (binding.mode === "pinned") {
            return {
                label: versionTag(bound?.version),
                hint: bound?.message?.trim() ? `— ${bound.message.trim()}` : "",
            }
        }
        return {label: "Latest", hint: bound ? `— ${versionTag(bound.version)} right now` : ""}
    }, [binding.mode, bound])

    return (
        <Select
            value={value}
            onValueChange={(next) => {
                const parsed = parseValue(next, workflowId)
                if (parsed) onChange(parsed)
            }}
            disabled={disabled || !workflowId}
        >
            {/* Derive the height from padding + line-height like Input does, so this lines up
                with the other fields. SelectTrigger's own `h-control` is 2px shorter. */}
            <SelectTrigger className="h-auto py-input-y">
                <SelectValue>
                    <span className="flex min-w-0 items-baseline gap-2">
                        <span className="shrink-0 text-xs font-medium text-[var(--ag-colorText)]">
                            {label}
                        </span>
                        <span className="min-w-0 truncate text-xs text-[var(--ag-colorTextDescription)]">
                            {hint}
                        </span>
                    </span>
                </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-[320px]">
                {variants.data.length === 0 && !variants.isPending ? (
                    <span className="block px-3 py-2 text-xs text-[var(--ag-colorTextDescription)]">
                        This agent has no versions yet.
                    </span>
                ) : null}
                {variants.data.map((v) => (
                    <VariantOptions
                        key={v.id}
                        variantId={v.id}
                        variantName={v.name?.trim() || v.slug?.trim() || "Variant"}
                        // A single-variant app needs no grouping header — the common case.
                        showHeader={variants.data.length > 1}
                    />
                ))}
            </SelectContent>
        </Select>
    )
}
