import {
    isLatestRevisionAtomFamily,
    workflowMolecule,
    workflowRevisionsByWorkflowListDataAtomFamily,
    workflowRevisionsByWorkflowQueryAtomFamily,
} from "@agenta/entities/workflow"
import {
    agentAutoCommitErrorAtomFamily,
    agentAutoCommitStatusAtomFamily,
} from "@agenta/playground/state"
import {agentAutoCommitHeldAtomFamily} from "@agenta/shared/state"
import {timeAgo} from "@agenta/shared/utils"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
    SimpleTooltip,
} from "@agenta/ui/ui"
import {CaretDown, Check, WarningCircle} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

export interface AgentRevisionStatusProps {
    /** The revision whose version and dirty state this reads. */
    revisionId: string
    /**
     * Turn the `vN` chip into a picker over this workflow's revisions. Omit where the surface
     * already has one (the desktop's variant selector sits beside this).
     */
    pickerWorkflowId?: string | null
    /** Required with `pickerWorkflowId` — the host decides what selecting a revision means. */
    onSelectRevision?: (revisionId: string) => void
    className?: string
}

/**
 * The revision list behind the chip. Its rows carry the commit message, so the picker form drops
 * the chip's message tooltip — the same text, one tap away instead of on hover.
 */
const RevisionPicker = ({
    workflowId,
    revisionId,
    version,
    onSelectRevision,
}: {
    workflowId: string
    revisionId: string
    version: number
    onSelectRevision: (revisionId: string) => void
}) => {
    // Reading the query atom is what fetches; the list atom resolves the refs it primes.
    useAtomValue(workflowRevisionsByWorkflowQueryAtomFamily(workflowId))
    const revisions = useAtomValue(workflowRevisionsByWorkflowListDataAtomFamily(workflowId))

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label="Select revision"
                    className="flex cursor-pointer items-center rounded border-0 bg-colorFillSecondary px-1.5 py-0.5 text-xs text-colorTextSecondary hover:text-colorText"
                >
                    v{version}
                    <CaretDown size={9} className="ml-1" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[280px]">
                <DropdownMenuLabel>Revisions</DropdownMenuLabel>
                {revisions.length === 0 ? (
                    <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
                ) : null}
                {revisions.map((revision) => (
                    <DropdownMenuItem
                        key={revision.id}
                        onSelect={() => onSelectRevision(revision.id)}
                    >
                        {revision.id === revisionId ? (
                            <Check size={12} />
                        ) : (
                            <span className="inline-block w-[12px]" />
                        )}
                        <span className="shrink-0">v{revision.version ?? 0}</span>
                        <span className="min-w-0 flex-1 truncate text-colorTextSecondary">
                            {revision.message?.trim() || "No commit message"}
                        </span>
                        {revision.created_at ? (
                            <span className="shrink-0 text-colorTextTertiary">
                                {timeAgo(Date.parse(revision.created_at))}
                            </span>
                        ) : null}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

/**
 * A revision's committed identity: the `vN` chip (its commit message on hover) and a save-status
 * dot. With `pickerWorkflowId` the chip becomes a revision picker instead.
 *
 * On the latest revision the dot reports auto-commit — Saving… / Saved — because saving happens
 * on its own (#6126). It is status only: the Save that a stale, failed, or stranded draft needs
 * lives in the config header (`AgentSaveButton`), next to what it acts on.
 *
 * Rendered by every surface that shows an agent's header — the desktop playground's revision
 * selector and the mobile session workspace's top bar — so the two can never disagree about
 * what "saved" looks like.
 */
export const AgentRevisionStatus = ({
    revisionId,
    pickerWorkflowId,
    onSelectRevision,
    className,
}: AgentRevisionStatusProps) => {
    const data = useAtomValue(workflowMolecule.selectors.data(revisionId || ""))
    const isDirty = useAtomValue(workflowMolecule.selectors.isDirty(revisionId || ""))
    const isAgent = useAtomValue(workflowMolecule.selectors.isAgent(revisionId || ""))
    const autoCommitStatus = useAtomValue(agentAutoCommitStatusAtomFamily(revisionId || ""))
    const autoCommitError = useAtomValue(agentAutoCommitErrorAtomFamily(revisionId || ""))
    const autoCommitHeld = useAtomValue(agentAutoCommitHeldAtomFamily(revisionId || ""))

    // Shared with the flush predicate, so the Save button and auto-commit can't disagree.
    const isLatest = useAtomValue(isLatestRevisionAtomFamily(revisionId || ""))

    const version = (data?.version as number | null | undefined) ?? null
    const commitMessage = data?.message?.trim() || null

    const failed = autoCommitStatus === "error"
    const saving = autoCommitStatus === "saving" || autoCommitStatus === "pending"
    // Auto-commit owns the dot only where it actually runs.
    const autoSaves = isAgent && isLatest && !failed && saving

    // "Saving…" must mean a request is actually in flight. A save parked behind a live run can
    // wait minutes, and labelling that "Saving…" reads as a hang.
    const dot = failed
        ? {
              tone: "bg-colorError",
              label: "Not saved",
              tip: autoCommitError ?? "Couldn't save changes",
          }
        : autoSaves
          ? autoCommitHeld
              ? {
                    tone: "bg-colorWarning",
                    label: "Save pending",
                    tip: "Saving when this run finishes",
                }
              : {tone: "bg-colorTextTertiary", label: "Saving…", tip: "Saving your changes"}
          : isDirty
            ? {tone: "bg-colorWarning", label: "Draft", tip: "Draft — unsaved changes"}
            : {tone: "bg-colorSuccess", label: "Saved", tip: "Saved"}

    return (
        <div className={`flex items-center gap-2 ${className ?? ""}`}>
            {version !== null &&
                (pickerWorkflowId && onSelectRevision ? (
                    <RevisionPicker
                        workflowId={pickerWorkflowId}
                        revisionId={revisionId}
                        version={version}
                        onSelectRevision={onSelectRevision}
                    />
                ) : (
                    <SimpleTooltip
                        className="max-w-[360px]"
                        title={
                            commitMessage ? (
                                <div className="flex flex-col gap-1">
                                    <span className="text-[12px] font-medium uppercase tracking-wide opacity-65">
                                        Commit message
                                    </span>
                                    <div className="max-h-[240px] overflow-y-auto overscroll-contain whitespace-pre-wrap break-words text-xs leading-relaxed">
                                        {commitMessage}
                                    </div>
                                </div>
                            ) : (
                                <span className="text-xs italic">No commit message</span>
                            )
                        }
                    >
                        <span className="cursor-default rounded bg-colorFillSecondary px-1.5 py-0.5 text-xs text-colorTextSecondary">
                            v{version}
                        </span>
                    </SimpleTooltip>
                ))}
            <SimpleTooltip title={dot.tip}>
                <span className="flex items-center gap-1.5 text-xs text-colorTextTertiary">
                    {failed ? (
                        <WarningCircle size={12} className="shrink-0 text-colorError" />
                    ) : (
                        <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${dot.tone}`} />
                    )}
                    {/* The word is the first thing to go on a narrow bar — the dot and its
                        tooltip already say it, and the identity beside it needs the room. */}
                    <span className="hidden sm:inline">{dot.label}</span>
                </span>
            </SimpleTooltip>
        </div>
    )
}
