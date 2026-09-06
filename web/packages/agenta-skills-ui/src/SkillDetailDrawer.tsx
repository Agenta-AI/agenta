/**
 * Skill detail — the drawer a registry card opens (artboards 2/2b), one shell with the
 * editor anatomy throughout:
 *
 * - Read-only by default: SkillFormView disabled, the rail's bottom card is VERSIONS
 *   (replacing the drop zone) and clicking a row navigates revisions. USED BY chips sit
 *   under the header line.
 * - Viewing an older revision swaps the footer to `Restore as vN+1` (a normal new commit).
 * - `Edit skill` turns the same drawer editable; Save opens the blast-radius dialog (5b) —
 *   the explicit replacement for silent auto-commit — then commits vN+1.
 *
 * Connected on purpose (like the create drawer): revisions/usage load and the commit live
 * here once; hosts pass `projectId` and the card's list item.
 */
import {useCallback, useMemo, useState} from "react"

import {SkillFormView} from "@agenta/entity-ui/drill-in"
import {
    commitSkillRevision,
    fetchSkillRevisions,
    querySkillUsage,
    skillContentSchema,
    type SkillRevision,
} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {
    Button,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    Input,
    Spinner,
} from "@agenta/ui/ui"
import {Lightning, PencilSimple, WarningCircle} from "@phosphor-icons/react"
import {useQuery} from "@tanstack/react-query"

import {SkillAvatar, VersionTag} from "./SkillCard"
import {SkillSaveBlastRadius} from "./SkillSaveBlastRadius"
import type {SkillListItem, SkillUsageRef, SkillVersionRow} from "./types"
import {VersionsRailCard} from "./VersionsRailCard"

export interface SkillDetailDrawerProps {
    open: boolean
    onClose: () => void
    projectId: string
    /** The clicked card. Null renders nothing (the drawer stays mounted for the exit animation). */
    skill: SkillListItem | null
    width?: number
}

const toFormValue = (skill?: Record<string, unknown>): Record<string, unknown> => ({
    name: skill?.name ?? "",
    description: skill?.description ?? "",
    body: skill?.body ?? "",
    files: Array.isArray(skill?.files) ? skill.files : [],
    ...(skill?.disable_model_invocation != null
        ? {disable_model_invocation: skill.disable_model_invocation}
        : {}),
    ...(skill?.allow_executable_files != null
        ? {allow_executable_files: skill.allow_executable_files}
        : {}),
})

const shortAge = (iso?: string): string | undefined => {
    if (!iso) return undefined
    const ms = Date.now() - new Date(iso).getTime()
    if (!Number.isFinite(ms) || ms < 0) return undefined
    const days = Math.floor(ms / 86_400_000)
    if (days >= 1) return `${days}d`
    const hours = Math.floor(ms / 3_600_000)
    return hours >= 1 ? `${hours}h` : "now"
}

/** First zod issue → one human line, mirroring the create drawer. */
const firstIssue = (error: {issues: {path: PropertyKey[]; message: string}[]}): string => {
    const issue = error.issues[0]
    if (!issue) return "Invalid skill."
    const path = issue.path.join(".")
    const message = /Too small.*>=1/.test(issue.message) ? "is required" : issue.message
    return path ? `${path} ${message}` : message
}

export function SkillDetailDrawer({
    open,
    onClose,
    projectId,
    skill,
    width = 960,
}: SkillDetailDrawerProps) {
    // The list item's id IS the workflow id (the hosts map workflow_id into it).
    const workflowId = skill?.id ?? ""
    const isBuiltin = skill?.origin === "builtin"

    const revisionsQuery = useQuery({
        queryKey: ["skills", "revisions", projectId, workflowId],
        queryFn: () => fetchSkillRevisions({projectId, workflowId}),
        enabled: open && Boolean(projectId && workflowId) && !isBuiltin,
        staleTime: 15_000,
    })
    const usageQuery = useQuery({
        queryKey: ["skills", "usage", projectId, workflowId],
        queryFn: () => querySkillUsage({projectId, workflowId}),
        enabled: open && Boolean(projectId && workflowId) && !isBuiltin,
        staleTime: 15_000,
    })

    const revisions = useMemo(() => revisionsQuery.data ?? [], [revisionsQuery.data])
    const head: SkillRevision | undefined = revisions[0]

    const usedBy = useMemo<SkillUsageRef[]>(
        () =>
            (usageQuery.data?.usage ?? []).map((entry) => ({
                id: entry.agent_workflow_id ?? entry.agent_slug ?? "",
                name: entry.agent_name ?? entry.agent_slug ?? "unknown agent",
                mode: entry.mode ?? "latest",
                pinnedVersion: entry.pinned_version?.replace(/^v/, "") ?? undefined,
            })),
        [usageQuery.data],
    )

    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState<Record<string, unknown>>({})
    const [saveOpen, setSaveOpen] = useState(false)
    const [saveMessage, setSaveMessage] = useState("")
    /** What the pending commit contains: the edited draft, or an older revision's content. */
    const [pending, setPending] = useState<Record<string, unknown> | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Fresh state per open — closing only closes, so the exit animation keeps its frame.
    const [wasOpen, setWasOpen] = useState(false)
    if (open !== wasOpen) {
        setWasOpen(open)
        if (open) {
            setSelectedId(null)
            setEditing(false)
            setSaveOpen(false)
            setSaveMessage("")
            setPending(null)
            setError(null)
        }
    }

    const selected = useMemo(
        () => (selectedId ? revisions.find((rev) => rev.id === selectedId) : head) ?? head,
        [head, revisions, selectedId],
    )
    const viewingOlder = Boolean(selected && head && selected.id !== head.id)
    const nextVersion = String(Number(head?.version ?? "0") + 1)

    const versionRows = useMemo<SkillVersionRow[]>(
        () =>
            revisions.map((rev) => ({
                id: rev.id,
                version: rev.version ?? "?",
                message: rev.message,
                age: shortAge(rev.createdAt),
            })),
        [revisions],
    )

    const startEdit = useCallback(() => {
        setDraft(toFormValue(selected?.skill))
        setSelectedId(null)
        setEditing(true)
        setError(null)
    }, [selected])

    const askToCommit = useCallback((content: Record<string, unknown>, defaultMessage: string) => {
        const parsed = skillContentSchema.safeParse(content)
        if (!parsed.success) {
            setError(firstIssue(parsed.error))
            return
        }
        setPending(parsed.data)
        setSaveMessage(defaultMessage)
        setError(null)
        setSaveOpen(true)
    }, [])

    const commit = useCallback(async () => {
        if (!pending || !head) return
        setBusy(true)
        setError(null)
        try {
            await commitSkillRevision({
                projectId,
                workflowId,
                variantId: head.variantId,
                skill: pending,
                message: saveMessage.trim() || undefined,
            })
            invalidateSkillsListCache()
            await revisionsQuery.refetch()
            setSaveOpen(false)
            setPending(null)
            setEditing(false)
            setSelectedId(null)
        } catch (err) {
            setError(
                err instanceof Error && err.message
                    ? `Save failed: ${err.message}`
                    : "Save failed.",
            )
        } finally {
            setBusy(false)
        }
    }, [head, pending, projectId, revisionsQuery, saveMessage, workflowId])

    const formValue = useMemo(
        () => (editing ? draft : toFormValue(selected?.skill)),
        [draft, editing, selected],
    )

    const title = (
        <div className="flex min-w-0 items-center gap-2">
            {skill ? <SkillAvatar origin={skill.origin} /> : null}
            <span className="min-w-0 truncate font-mono text-sm font-medium">
                {skill?.slug ?? ""}
            </span>
            {selected?.version ? <VersionTag version={selected.version} /> : null}
            {viewingOlder ? (
                <span className="shrink-0 rounded bg-[var(--ag-colorFillTertiary)] px-1.5 py-px text-[10px] text-[var(--ag-colorTextTertiary)]">
                    viewing v{selected?.version} — read-only
                </span>
            ) : null}
            {isBuiltin ? (
                <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-[var(--ag-colorTextTertiary)]">
                    <Lightning size={10} weight="fill" />
                    Provided by Agenta — read-only
                </span>
            ) : null}
        </div>
    )

    return (
        <>
            <EnhancedDrawer
                rootClassName="ag-drawer-elevated"
                open={open}
                onClose={onClose}
                placement="right"
                width={width}
                destroyOnClose
                title={title}
                styles={{
                    body: {
                        padding: 0,
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                    },
                }}
                footer={
                    <div className="flex items-center justify-between gap-3">
                        {error ? (
                            <span className="flex min-w-0 items-start gap-1.5 text-xs text-[var(--ag-colorError)]">
                                <WarningCircle size={14} className="mt-px shrink-0" />
                                <span className="min-w-0">{error}</span>
                            </span>
                        ) : (
                            <span />
                        )}
                        <span className="flex shrink-0 items-center gap-2">
                            {editing ? (
                                <>
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            setEditing(false)
                                            setError(null)
                                        }}
                                        disabled={busy}
                                    >
                                        Cancel
                                    </Button>
                                    <Button onClick={() => askToCommit(draft, "")} disabled={busy}>
                                        Save changes
                                    </Button>
                                </>
                            ) : viewingOlder ? (
                                <Button
                                    onClick={() =>
                                        askToCommit(
                                            toFormValue(selected?.skill),
                                            `Restore v${selected?.version}`,
                                        )
                                    }
                                    disabled={busy}
                                >
                                    Restore as v{nextVersion}
                                </Button>
                            ) : !isBuiltin ? (
                                <Button onClick={startEdit} disabled={busy || !head}>
                                    <PencilSimple size={14} />
                                    Edit skill
                                </Button>
                            ) : null}
                        </span>
                    </div>
                }
            >
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
                    {!editing && usedBy.length ? (
                        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                                Used by
                            </span>
                            {usedBy.map((agent) => (
                                <span
                                    key={agent.id}
                                    className="flex items-center gap-1 rounded-full border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)] px-2 py-px text-[11px]"
                                >
                                    <span className="max-w-40 truncate">{agent.name}</span>
                                    <span className="text-[var(--ag-colorTextTertiary)]">
                                        {agent.mode === "pinned"
                                            ? `pinned v${agent.pinnedVersion ?? "?"}`
                                            : "latest"}
                                    </span>
                                </span>
                            ))}
                        </div>
                    ) : null}

                    {isBuiltin ? (
                        <div className="flex flex-col gap-2 rounded-md border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)] p-4 text-xs">
                            <span className="font-mono font-medium">{skill?.slug}</span>
                            <span className="text-[var(--ag-colorTextSecondary)]">
                                {skill?.description || "No description."}
                            </span>
                            <span className="text-[var(--ag-colorTextTertiary)]">
                                Built-in skills are maintained by Agenta and cannot be edited.
                            </span>
                        </div>
                    ) : revisionsQuery.isPending ? (
                        <div className="flex flex-1 items-center justify-center">
                            <Spinner size="small" />
                        </div>
                    ) : (
                        <div className="min-h-0 flex-1 overflow-y-auto">
                            <SkillFormView
                                value={formValue}
                                onChange={editing ? setDraft : () => undefined}
                                disabled={!editing || busy}
                                railBottomSlot={
                                    !editing && versionRows.length ? (
                                        <VersionsRailCard
                                            versions={versionRows}
                                            activeId={selected?.id}
                                            onSelect={(row) =>
                                                setSelectedId(row.id === head?.id ? null : row.id)
                                            }
                                        />
                                    ) : undefined
                                }
                            />
                        </div>
                    )}
                </div>
            </EnhancedDrawer>

            {/* Radix Dialog, not EnhancedModal: /m renders this drawer and antd is banned there. */}
            <Dialog
                open={saveOpen}
                onOpenChange={(next) => {
                    if (!next && !busy) setSaveOpen(false)
                }}
            >
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Commit v{nextVersion}</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-3">
                        <SkillSaveBlastRadius
                            fromVersion={head?.version ?? "?"}
                            toVersion={nextVersion}
                            usedBy={usedBy}
                        />
                        <Input
                            value={saveMessage}
                            onChange={(e) => setSaveMessage(e.target.value)}
                            placeholder="What changed? (commit message)"
                            aria-label="Commit message"
                            disabled={busy}
                        />
                        {error ? (
                            <span className="flex items-start gap-1.5 text-xs text-[var(--ag-colorError)]">
                                <WarningCircle size={14} className="mt-px shrink-0" />
                                <span className="min-w-0">{error}</span>
                            </span>
                        ) : null}
                        <div className="flex items-center justify-end gap-2">
                            <Button
                                variant="outline"
                                onClick={() => setSaveOpen(false)}
                                disabled={busy}
                            >
                                Cancel
                            </Button>
                            <Button onClick={() => void commit()} disabled={busy}>
                                {busy ? <Spinner size="small" /> : null}
                                Commit v{nextVersion}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
