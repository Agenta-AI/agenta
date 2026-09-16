/**
 * Skill detail — the drawer a registry card opens (artboards 2/2b), one shell with the
 * editor anatomy throughout:
 *
 * - Editable as soon as the head loads, always showing the head. USED BY chips sit under
 *   the header line. Revision history is deliberately not surfaced: versioning stays under
 *   the hood.
 * - A changed draft grows Discard / Save; Save opens the blast-radius dialog (5b) — the
 *   explicit replacement for silent auto-commit — then commits.
 * - The skill's own verbs — Add to agent, Archive / Restore — live in the header's kebab.
 *
 * Connected on purpose (like the create drawer): revisions/usage load and the commit live
 * here once; hosts pass `projectId` and the card's list item.
 */
import {useCallback, useMemo, useRef, useState} from "react"

import {AgentPickerPanel} from "@agenta/entity-ui/agent"
import {SkillFormView} from "@agenta/entity-ui/drill-in"
import {cn} from "@agenta/ui/styles"
import {
    addSkillToAgents,
    archiveSkill,
    buildSkillEmbedEntry,
    commitSkillRevision,
    fetchSkillRevisions,
    querySkillReferencedBy,
    skillContentSchema,
    unarchiveSkill,
    type SkillRevision,
} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    Input,
    Popover,
    PopoverAnchor,
    PopoverContent,
    PopoverTrigger,
    Spinner,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {
    Archive,
    ArrowUUpLeft,
    DotsThreeVertical,
    Info,
    Lightning,
    Plus,
    Robot,
    WarningCircle,
} from "@phosphor-icons/react"
import {useQuery} from "@tanstack/react-query"

import {SkillSaveBlastRadius} from "./SkillSaveBlastRadius"
import type {SkillListItem, SkillUsageRef} from "./types"

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

/** A row of the actions popover — the filter menu's row, restated: icon, label, full width. */
const ACTION_ROW =
    "box-border flex w-full cursor-pointer appearance-none items-center gap-2 rounded-control-sm border-0 bg-transparent px-2 py-1.5 text-left font-[inherit] text-[13px] text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent disabled:cursor-default disabled:opacity-50"

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
        queryFn: () => querySkillReferencedBy({projectId, workflowId}),
        enabled: open && Boolean(projectId && workflowId) && !isBuiltin,
        staleTime: 15_000,
    })

    const revisions = useMemo(() => revisionsQuery.data ?? [], [revisionsQuery.data])
    const head: SkillRevision | undefined = revisions[0]

    const usedBy = useMemo<SkillUsageRef[]>(
        () =>
            (usageQuery.data?.referenced_by ?? []).map((entry) => ({
                id: entry.agent_workflow_id ?? entry.agent_slug ?? "",
                name: entry.agent_name ?? entry.agent_slug ?? "unknown agent",
                mode: entry.mode ?? "latest",
                pinnedVersion: entry.pinned_version?.replace(/^v/, "") ?? undefined,
            })),
        [usageQuery.data],
    )
    const [draft, setDraft] = useState<Record<string, unknown>>({})
    const [saveOpen, setSaveOpen] = useState(false)
    const [saveMessage, setSaveMessage] = useState("")
    /** What the pending commit contains: the edited draft, or an older revision's content. */
    const [pending, setPending] = useState<Record<string, unknown> | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)


    // Archive keeps the slug reserved; the registry hides the skill until unarchived. Its
    // confirm covers the drawer, not the window: the question is about what the drawer shows.
    const [panel, setPanel] = useState<HTMLDivElement | null>(null)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [archiveBusy, setArchiveBusy] = useState(false)
    const [archiveError, setArchiveError] = useState<string | null>(null)
    const runArchive = useCallback(async () => {
        if (!workflowId) return
        setArchiveBusy(true)
        setArchiveError(null)
        try {
            await archiveSkill({projectId, workflowId})
            invalidateSkillsListCache()
            setArchiveOpen(false)
            onClose()
        } catch (err) {
            setArchiveError(err instanceof Error && err.message ? err.message : "Archiving failed.")
        } finally {
            setArchiveBusy(false)
        }
    }, [onClose, projectId, workflowId])
    const runUnarchive = useCallback(async () => {
        if (!workflowId) return
        setArchiveBusy(true)
        setArchiveError(null)
        try {
            await unarchiveSkill({projectId, workflowId})
            invalidateSkillsListCache()
            onClose()
        } catch (err) {
            setArchiveError(
                err instanceof Error && err.message ? err.message : "Unarchiving failed.",
            )
        } finally {
            setArchiveBusy(false)
        }
    }, [onClose, projectId, workflowId])

    /** The revision the draft started from — the concurrency base. Captured when the
     * draft is SEEDED, because a background refetch can move `head` while the drawer is
     * open, and committing against a base the author never saw is exactly what the check
     * exists to prevent. */
    const [editBaseId, setEditBaseId] = useState<string | null>(null)

    // Fresh state per open — closing only closes, so the exit animation keeps its frame.
    const [wasOpen, setWasOpen] = useState(false)
    if (open !== wasOpen) {
        setWasOpen(open)
        if (open) {
            setEditBaseId(null)
            setSaveOpen(false)
            setSaveMessage("")
            setPending(null)
            setError(null)
            setArchiveOpen(false)
        }
    }

    // Version numbers are deliberately not surfaced, so the drawer always shows the head.

    // The form is editable from the start: the draft seeds from the head once per open (and
    // again after a commit, which clears the base), never over an edit in progress.
    if (head && editBaseId === null) {
        setDraft(toFormValue(head.skill))
        setEditBaseId(head.id)
    }
    const headValue = useMemo(() => toFormValue(head?.skill), [head])
    const dirty = useMemo(
        () => editBaseId !== null && JSON.stringify(draft) !== JSON.stringify(headValue),
        [draft, editBaseId, headValue],
    )
    const discard = useCallback(() => {
        setDraft(headValue)
        setError(null)
    }, [headValue])

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
                skill: pending,
                message: saveMessage.trim() || undefined,
                // The revision this edit started from; a commit landed meanwhile
                // conflicts instead of silently overwriting it.
                baseRevisionId: editBaseId ?? head.id,
            })
            invalidateSkillsListCache()
            await revisionsQuery.refetch()
            setSaveOpen(false)
            setPending(null)
            // Clearing the base reseeds the draft from the head the refetch just brought.
            setEditBaseId(null)
        } catch (err) {
            setError(
                err instanceof Error && err.message
                    ? `Save failed: ${err.message}`
                    : "Save failed.",
            )
        } finally {
            setBusy(false)
        }
    }, [editBaseId, head, pending, projectId, revisionsQuery, saveMessage, workflowId])

    const usedByIds = useMemo(() => new Set(usedBy.map((agent) => agent.id)), [usedBy])
    const usedByIdList = useMemo(() => [...usedByIds], [usedByIds])
    // One agent at a time, from the kebab's submenu: the tick is the action, and the drawer
    // stays where it is — the header's count answers whether it landed.
    const [addingTo, setAddingTo] = useState<string | null>(null)
    const addToAgent = useCallback(
        async (agentWorkflowId: string) => {
            if (!skill) return
            setAddingTo(agentWorkflowId)
            setError(null)
            try {
                const entry = buildSkillEmbedEntry({
                    slug: skill.slug,
                    workflowId: skill.id,
                    name: skill.name,
                    description: skill.description,
                    mode: "latest",
                }) as unknown as Record<string, unknown>
                const outcome = await addSkillToAgents({
                    projectId,
                    agentWorkflowIds: [agentWorkflowId],
                    entry,
                    message: `Add skill ${skill.slug}`,
                })
                if (outcome.failed.length) {
                    setError(`Couldn't add to that agent: ${outcome.failed[0].error}`)
                }
                await usageQuery.refetch()
                invalidateSkillsListCache()
            } finally {
                setAddingTo(null)
            }
        },
        [projectId, skill, usageQuery],
    )

    // Read-only where there is nothing to write to: a built-in, or a skill that is put away.
    const readOnly = isBuiltin || Boolean(skill?.archived)

    // The skill's own verbs, at the header's right. A popover with rows, not a menu, the way the
    // filter control is built: the Add to agent row opens the agent picker's panel as a flyout,
    // and that panel carries a search field a menu's typeahead would fight for every keystroke.
    const [menuOpen, setMenuOpen] = useState(false)
    const [agentsOpen, setAgentsOpen] = useState(false)
    // The flyout closes a beat after the pointer leaves, so crossing the gap between the row
    // and the panel does not shut it — the filter menu's own timing.
    const agentsCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const openAgents = useCallback(() => {
        if (agentsCloseTimer.current) clearTimeout(agentsCloseTimer.current)
        setAgentsOpen(true)
    }, [])
    const scheduleCloseAgents = useCallback(() => {
        if (agentsCloseTimer.current) clearTimeout(agentsCloseTimer.current)
        agentsCloseTimer.current = setTimeout(() => setAgentsOpen(false), 140)
    }, [])
    const closeMenu = useCallback(() => {
        if (agentsCloseTimer.current) clearTimeout(agentsCloseTimer.current)
        setAgentsOpen(false)
        setMenuOpen(false)
    }, [])
    const actions =
        !isBuiltin && skill ? (
            <Popover
                open={menuOpen}
                onOpenChange={(next) => {
                    setMenuOpen(next)
                    if (!next) setAgentsOpen(false)
                }}
            >
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Skill actions"
                        disabled={busy || archiveBusy}
                        // The header's close button gives 2px back on each side to sit on the
                        // title's 24px line; a 32px button gives back 4, for the same reason.
                        className="-my-1"
                    >
                        <DotsThreeVertical aria-hidden className="size-4" weight="bold" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="end" sideOffset={6} className="flex w-[200px] flex-col p-1">
                    {skill.archived ? (
                        <button
                            type="button"
                            onClick={() => {
                                closeMenu()
                                void runUnarchive()
                            }}
                            className={ACTION_ROW}
                        >
                            <ArrowUUpLeft aria-hidden size={14} className="text-muted-foreground" />
                            Restore
                        </button>
                    ) : (
                        <>
                            {/* Opens on hover, as the filter menu's rows do: the row is an
                                anchor, not a trigger, so a click on a row the pointer already
                                opened does not shut it again. */}
                            <Popover open={agentsOpen} onOpenChange={setAgentsOpen}>
                                <PopoverAnchor asChild>
                                    <button
                                        type="button"
                                        aria-haspopup="listbox"
                                        aria-expanded={agentsOpen}
                                        disabled={!head}
                                        onClick={openAgents}
                                        onMouseEnter={openAgents}
                                        onMouseLeave={scheduleCloseAgents}
                                        className={cn(ACTION_ROW, agentsOpen && "bg-accent")}
                                    >
                                        <Plus aria-hidden size={14} className="text-muted-foreground" />
                                        <span className="flex-1">Add to agent</span>
                                    </button>
                                </PopoverAnchor>
                                <PopoverContent
                                    side="left"
                                    align="start"
                                    sideOffset={6}
                                    aria-label="Add to agent"
                                    className="flex w-[280px] flex-col gap-0 p-0"
                                    onOpenAutoFocus={(event) => event.preventDefault()}
                                    onMouseEnter={openAgents}
                                    onMouseLeave={scheduleCloseAgents}
                                >
                                    <AgentPickerPanel
                                        selectedIds={usedByIdList}
                                        selectedInert
                                        pendingId={addingTo}
                                        onSelect={(id) => void addToAgent(id)}
                                    />
                                </PopoverContent>
                            </Popover>
                            <button
                                type="button"
                                onClick={() => {
                                    closeMenu()
                                    setArchiveOpen(true)
                                }}
                                className={cn(ACTION_ROW, "text-[var(--ag-colorError)]")}
                            >
                                <Archive aria-hidden size={14} />
                                Archive
                            </button>
                        </>
                    )}
                </PopoverContent>
            </Popover>
        ) : null

    // Provenance sits behind an info mark beside the name: a reader who wants to know where a
    // skill came from hovers; the header stays one line.
    const provenance = skill?.source ? (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        aria-label="Where this skill came from"
                        className="box-border inline-flex shrink-0 cursor-help items-center border-0 bg-transparent p-0 font-[inherit] text-[var(--ag-colorTextTertiary)] hover:text-[var(--ag-colorText)]"
                    >
                        <Info size={14} aria-hidden />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start">
                    <span className="flex flex-col gap-0.5">
                        <span>
                            Imported from <span className="font-mono">{skill.source.label}</span>
                        </span>
                        {skill.source.detached ? (
                            <span className="opacity-80">Modified locally — no longer synced</span>
                        ) : null}
                    </span>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    ) : null

    // Who runs it sits behind a count beside the name, the way provenance does: the body stays
    // the editor, and the names are one hover away.
    const usage = usedBy.length ? (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        aria-label={`Used by ${usedBy.length} ${usedBy.length === 1 ? "agent" : "agents"}`}
                        className="box-border inline-flex shrink-0 cursor-help items-center gap-1 border-0 bg-transparent p-0 font-[inherit] text-[11px] font-normal text-[var(--ag-colorTextTertiary)] hover:text-[var(--ag-colorText)]"
                    >
                        <Robot size={14} aria-hidden />
                        {usedBy.length}
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start">
                    <span className="flex flex-col gap-0.5">
                        <span className="opacity-80">Used by</span>
                        {usedBy.map((agent) => (
                            <span key={agent.id}>
                                {agent.name}
                                <span className="opacity-80">
                                    {" "}
                                    · {agent.mode === "pinned" ? `pinned v${agent.pinnedVersion ?? ""}` : "latest"}
                                </span>
                            </span>
                        ))}
                    </span>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    ) : null

    const title = (
        <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate font-mono text-sm font-medium">
                {skill?.slug ?? ""}
            </span>
            {provenance}
            {usage}
            {isBuiltin ? (
                <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-[var(--ag-colorTextTertiary)]">
                    <Lightning size={10} weight="fill" />
                    Provided by Agenta — read-only
                </span>
            ) : null}
            {skill?.archived ? (
                <span className="shrink-0 rounded bg-[var(--ag-colorFillTertiary)] px-1.5 py-px text-[10px] text-[var(--ag-colorTextTertiary)]">
                    Archived
                </span>
            ) : null}
        </div>
    )

    return (
        <>
            <EnhancedDrawer
                rootClassName="ag-drawer-elevated"
                panelRef={setPanel}
                open={open}
                onClose={onClose}
                placement="right"
                width={width}
                destroyOnClose
                title={title}
                extra={actions}
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
                                {archiveError ? (
                                    <span className="text-xs text-[var(--ag-colorError)]">
                                        {archiveError}
                                    </span>
                                ) : null}
                                {/* Always present, so the footer never changes shape under
                                    the reader; inert until the draft differs from the head. */}
                                {readOnly ? null : (
                                    <>
                                        <Button
                                            variant="outline"
                                            onClick={discard}
                                            disabled={busy || !dirty}
                                        >
                                            Discard
                                        </Button>
                                        <Button
                                            onClick={() => askToCommit(draft, "")}
                                            disabled={busy || !dirty}
                                        >
                                            Save changes
                                        </Button>
                                    </>
                                )}
                            </span>
                        </div>
                }
            >
                    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
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
                            // No overflow of its own: the rail bleeds 16px past this box to meet
                            // the header and footer rules, and a clipping box here cut it short.
                            // The editor scrolls; the outer wrapper clips at its padding edge.
                            <div className="min-h-0 flex-1">
                                <SkillFormView
                                    value={draft}
                                    onChange={readOnly ? () => undefined : setDraft}
                                    disabled={readOnly || busy}
                                />
                            </div>
                        )}
                    </div>
            </EnhancedDrawer>

            {/* An alert, not a dialog: it asks one question and offers no other way out. */}
            <AlertDialog
                open={archiveOpen}
                onOpenChange={(next) => {
                    if (!next && !archiveBusy) setArchiveOpen(false)
                }}
            >
                <AlertDialogContent
                    container={panel}
                    className="sm:max-w-[440px]"
                    onEscapeKeyDown={(event) => {
                        if (archiveBusy) event.preventDefault()
                    }}
                >
                    <AlertDialogHeader>
                        <AlertDialogTitle>Archive {skill?.slug}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            The skill leaves the registry and agents can no longer run it. Its name
                            stays reserved, and restoring it brings back its full history.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {usedBy.length ? (
                        <div className="flex items-start gap-1.5 rounded-md border border-solid border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] px-3 py-2 text-xs text-[var(--ag-colorWarningText)]">
                            <WarningCircle size={14} className="mt-px shrink-0" />
                            <span>
                                {usedBy.length}{" "}
                                {usedBy.length === 1
                                    ? "agent still references"
                                    : "agents still reference"}{" "}
                                this skill — runs will fail to resolve it until it is restored or
                                removed from the config.
                            </span>
                        </div>
                    ) : null}
                    {archiveError ? (
                        <p className="m-0 text-xs text-[var(--ag-colorError)]">{archiveError}</p>
                    ) : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button
                                variant="outline"
                                onClick={() => setArchiveOpen(false)}
                                disabled={archiveBusy}
                            >
                                Cancel
                            </Button>
                        </AlertDialogCancel>
                        {/* preventDefault keeps the alert open: it closes itself on success and
                            stays for the error otherwise. */}
                        <AlertDialogAction asChild>
                            <Button
                                variant="destructive"
                                disabled={archiveBusy}
                                onClick={(event) => {
                                    event.preventDefault()
                                    void runArchive()
                                }}
                            >
                                {archiveBusy ? <Spinner size="small" /> : null}
                                Archive skill
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Radix Dialog, not EnhancedModal: /m renders this drawer and antd is banned there. */}
            <Dialog
                open={saveOpen}
                onOpenChange={(next) => {
                    if (!next && !busy) setSaveOpen(false)
                }}
            >
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Save changes</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-3">
                        <SkillSaveBlastRadius usedBy={usedBy} />
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
                                Save
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
