import {useEffect, useMemo, useState, type ReactNode} from "react"

import {downloadSkill} from "@agenta/entity-ui/drill-in"
import {timeAgo} from "@agenta/shared/utils"
import {
    applySkillUpdate,
    checkSkillUpdate,
    commitSkillRevision,
    fetchSkillRevisions,
    querySkillReferencedBy,
    skillContentSchema,
    unarchiveSkill,
} from "@agenta/skills"
import {invalidateSkillsListCache, skillsResolveDataAtom} from "@agenta/skills/state"
import {message} from "@agenta/ui/app-message"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
    Popover,
    PopoverContent,
    PopoverTrigger,
    SkeletonBlock,
    Spinner,
} from "@agenta/ui/ui"
import {
    Archive,
    ArrowSquareOut,
    ArrowsClockwise,
    ArrowUUpLeft,
    CaretDown,
    CheckCircle,
    DotsThreeVertical,
    DownloadSimple,
    GithubLogo,
    Robot,
    WarningCircle,
    X,
} from "@phosphor-icons/react"
import {useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import Link from "next/link"

import {SkillArchiveDialog, type ArchiveTarget} from "./SkillArchiveDialog"
import {skillUsageQueryKey} from "./SkillAgentPicker"
import {
    descriptionTooLong,
    EMPTY_SKILL_DRAFT,
    sameSkillDraft,
    skillDraftProblem,
    toSkillContent,
    toSkillDraft,
    type SkillDraft,
} from "./skillDraft"
import {SkillEditor} from "./SkillEditor"

export const skillRevisionsQueryKey = (projectId: string, workflowId: string) =>
    ["skills", "revisions", projectId, workflowId] as const

export interface SkillDetailViewProps {
    projectId: string
    workflowId: string
    /** Where an agent's name leads. */
    agentHref?: (agentId: string) => string
    /** After an archive: the page goes back to the list, a drawer closes. */
    onArchived: (archived: ArchiveTarget[]) => void
    onDirtyChange?: (dirty: boolean) => void
    /** Drawn above the title. */
    top?: ReactNode
    /** In a drawer: a close button after the menu. */
    onClose?: () => void
}

const NOTICE = "flex animate-skill-enter items-center gap-2.5 rounded-[10px] px-3.5 py-2.5 text-sm"
const META_LINK =
    "inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 font-[inherit] text-[13px]"

function SourceDetails({origin}: {origin: NonNullable<SkillOrigin>}) {
    const rows: [string, ReactNode][] = [
        ["Repository", origin.repository],
        ["Folder", origin.path || "/"],
        ["Branch", origin.ref || "Default branch"],
        [
            "Version",
            origin.resolved_version ? (
                <code className="rounded bg-muted px-1 font-mono text-xs">
                    {origin.resolved_version.slice(0, 7)}
                </code>
            ) : (
                "Unknown"
            ),
        ],
    ]
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button type="button" className={`${META_LINK} text-foreground`}>
                    <GithubLogo size={14} />
                    {origin.repository}
                    <CaretDown size={12} />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[380px] max-w-[calc(100vw-32px)] px-4 pb-3.5 pt-2">
                {rows.map(([label, value], index) => (
                    <div
                        key={label}
                        className={`grid grid-cols-[96px_1fr] gap-3 py-[7px] text-[13px] leading-[18px] ${
                            index < rows.length - 1 ? "border-0 border-b border-solid border-border/60" : ""
                        }`}
                    >
                        <span className="text-muted-foreground">{label}</span>
                        <span className="min-w-0 [overflow-wrap:anywhere]">{value}</span>
                    </div>
                ))}
                <a
                    href={githubUrl(origin)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground"
                >
                    Open on GitHub
                    <ArrowSquareOut size={13} />
                </a>
            </PopoverContent>
        </Popover>
    )
}

type SkillOrigin = NonNullable<ReturnType<typeof useSkillItem>>["origin"]

const githubUrl = (origin: NonNullable<SkillOrigin>) =>
    `https://github.com/${origin.repository}/tree/${origin.ref || "HEAD"}/${origin.path ?? ""}`

const useSkillItem = (workflowId: string) => {
    const registry = useAtomValue(skillsResolveDataAtom)
    return registry.find((item) => item.workflow_id === workflowId || item.id === workflowId)
}

/** One skill: title, where it came from, who uses it, its editor, Save and its menu. */
export function SkillDetailView({
    projectId,
    workflowId,
    agentHref,
    onArchived,
    onDirtyChange,
    top,
    onClose,
}: SkillDetailViewProps) {
    const item = useSkillItem(workflowId)
    const origin = item?.origin?.repository ? item.origin : null
    const archived = Boolean(item?.archived)

    const revisions = useQuery({
        queryKey: skillRevisionsQueryKey(projectId, workflowId),
        queryFn: () => fetchSkillRevisions({projectId, workflowId}),
        enabled: Boolean(projectId && workflowId),
        staleTime: 15_000,
    })
    const usage = useQuery({
        queryKey: skillUsageQueryKey(projectId, workflowId),
        queryFn: () => querySkillReferencedBy({projectId, workflowId}),
        enabled: Boolean(projectId && workflowId),
        staleTime: 15_000,
    })
    const head = revisions.data?.[0]
    const headDraft = useMemo(
        () => (head ? toSkillDraft(head.skill) : EMPTY_SKILL_DRAFT),
        [head],
    )

    const [draft, setDraft] = useState<SkillDraft>(EMPTY_SKILL_DRAFT)
    // The head the draft started from; a newer head replaces it only while there are no edits.
    const [base, setBase] = useState<{id: string; draft: SkillDraft} | null>(null)
    const [attempted, setAttempted] = useState(false)
    const [saving, setSaving] = useState(false)
    const [justSaved, setJustSaved] = useState(false)
    const [update, setUpdate] = useState<"checking" | "available" | "current" | null>(null)
    const [archiveTargets, setArchiveTargets] = useState<ArchiveTarget[]>([])

    if (head && (!base || (base.id !== head.id && sameSkillDraft(draft, base.draft)))) {
        setBase({id: head.id, draft: headDraft})
        setDraft(headDraft)
    }
    const dirty = base !== null && !sameSkillDraft(draft, base.draft)
    useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])

    const edit = (next: SkillDraft) => {
        setDraft(next)
        setJustSaved(false)
    }

    const save = async () => {
        if (!base) return
        setAttempted(true)
        const problem = skillDraftProblem(draft)
        const parsed = skillContentSchema.safeParse(toSkillContent(draft))
        if (problem || !parsed.success) {
            message.error(problem ?? "This skill has a field the registry does not accept.")
            return
        }
        setSaving(true)
        try {
            const committed = await commitSkillRevision({
                projectId,
                workflowId,
                skill: parsed.data,
                baseRevisionId: base.id,
            })
            setBase({id: committed.revision_id ?? base.id, draft})
            invalidateSkillsListCache()
            await revisions.refetch()
            setAttempted(false)
            setJustSaved(true)
        } catch (err) {
            message.error(
                err instanceof Error && err.message ? `Save failed: ${err.message}` : "Save failed",
            )
        } finally {
            setSaving(false)
        }
    }

    const restore = async () => {
        try {
            await unarchiveSkill({projectId, workflowId})
            invalidateSkillsListCache()
            message.success(`${draft.title} is restored. Agents can use it again.`)
        } catch {
            message.error("Could not restore this skill")
        }
    }

    const check = async () => {
        setUpdate("checking")
        const result = await checkSkillUpdate({projectId, workflowId}).catch(() => null)
        if (result?.status === "update_available") {
            setUpdate("available")
            message.info(`${draft.title}: a new version is ready on GitHub.`)
        } else if (result?.status === "up_to_date") {
            setUpdate("current")
            message.success(`${draft.title} is up to date with GitHub.`)
        } else {
            setUpdate(null)
            message.error("Could not check for updates")
        }
    }

    const applyUpdate = async () => {
        const result = await applySkillUpdate({projectId, workflowId}).catch(() => null)
        if (result?.status !== "updated") {
            message.error("Could not update this skill")
            return
        }
        invalidateSkillsListCache()
        setBase(null)
        await revisions.refetch()
        setUpdate("current")
        message.success(`${draft.title} is updated from GitHub.`)
    }

    const download = () => {
        if (!head?.skill || !downloadSkill(head.skill)) message.error("Could not download this skill")
    }

    const agents = (usage.data?.referenced_by ?? []).map((entry) => ({
        id: entry.agent_workflow_id ?? entry.agent_slug ?? "",
        name: entry.agent_name ?? entry.agent_slug ?? "Unnamed agent",
    }))
    const usedText = agents.length
        ? `Used by ${agents.length === 1 ? agents[0].name : `${agents.length} agents`}`
        : "Not used by any agent yet"
    const edited = timeAgo(
        new Date(head?.createdAt ?? item?.updated_at ?? item?.created_at ?? "").getTime() || undefined,
    )

    const dot = <span aria-hidden>·</span>
    const meta = (
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] leading-[18px] text-muted-foreground">
            {origin ? (
                <>
                    <SourceDetails origin={origin} />
                    {dot}
                </>
            ) : null}
            {agents.length > 1 ? (
                <HoverCard openDelay={100}>
                    <HoverCardTrigger asChild>
                        <span tabIndex={0} className="cursor-default">
                            {usedText}
                        </span>
                    </HoverCardTrigger>
                    <HoverCardContent align="start" className="w-[240px] p-1.5">
                        <span className="block px-2 pb-1.5 pt-1 text-xs text-muted-foreground">
                            Used by {agents.length} agents
                        </span>
                        {agents.map((agent) => (
                            <AgentLink key={agent.id} agent={agent} href={agentHref} />
                        ))}
                    </HoverCardContent>
                </HoverCard>
            ) : (
                <span>{usedText}</span>
            )}
            {edited ? (
                <>
                    {dot}
                    <span>Edited {edited}</span>
                </>
            ) : null}
            {update === "available" ? (
                <>
                    {dot}
                    <button type="button" onClick={() => void applyUpdate()} className={`${META_LINK} text-tag-orange`}>
                        <span aria-hidden className="size-1.5 rounded-full bg-tag-orange" />
                        <span className="underline underline-offset-2">Update available</span>
                    </button>
                </>
            ) : update === "current" ? (
                <>
                    {dot}
                    <span className="text-tag-green">Up to date</span>
                </>
            ) : null}
        </div>
    )

    const actions = (
        <>
            {justSaved && !dirty ? (
                <span
                    role="status"
                    className="inline-flex animate-skill-enter items-center gap-1.5 pr-1 text-[13px] text-tag-green"
                >
                    <CheckCircle size={15} weight="fill" />
                    Saved
                </span>
            ) : null}
            {dirty && !archived ? (
                <Button
                    variant="outline"
                    onClick={() => base && setDraft(base.draft)}
                    disabled={saving}
                >
                    Discard
                </Button>
            ) : null}
            {archived ? null : (
                <Button onClick={() => void save()} disabled={!dirty || saving || descriptionTooLong(draft)}>
                    {saving ? <Spinner size="small" /> : null}
                    Save
                </Button>
            )}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" aria-label="More actions">
                        <DotsThreeVertical size={16} weight="bold" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[210px]">
                    <DropdownMenuItem onSelect={download}>
                        <DownloadSimple size={14} />
                        Download
                    </DropdownMenuItem>
                    {origin ? (
                        <>
                            <DropdownMenuItem disabled={update === "checking"} onSelect={() => void check()}>
                                <ArrowsClockwise size={14} />
                                Check for updates
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                                <a href={githubUrl(origin)} target="_blank" rel="noreferrer">
                                    <ArrowSquareOut size={14} />
                                    View on GitHub
                                </a>
                            </DropdownMenuItem>
                        </>
                    ) : null}
                    <DropdownMenuSeparator />
                    {archived ? (
                        <DropdownMenuItem onSelect={() => void restore()}>
                            <ArrowUUpLeft size={14} />
                            Restore
                        </DropdownMenuItem>
                    ) : (
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setArchiveTargets([{workflowId, title: draft.title}])}
                        >
                            <Archive size={14} />
                            Archive
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            {onClose ? (
                <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
                    <X size={16} />
                </Button>
            ) : null}
        </>
    )

    const notices = (
        <>
            {archived ? (
                <div role="status" className={`${NOTICE} border border-solid border-border bg-muted py-2 pr-2.5`}>
                    <Archive size={16} className="shrink-0 text-muted-foreground" />
                    <span className="flex-1">
                        This skill is archived. Agents do not use it, and you cannot edit it.
                    </span>
                    <Button variant="outline" size="sm" onClick={() => void restore()}>
                        Restore
                    </Button>
                </div>
            ) : null}
            {origin && !item?.origin?.detached && dirty ? (
                <div role="alert" className={`${NOTICE} items-start bg-tag-orange-bg text-tag-orange`}>
                    <WarningCircle size={16} className="mt-0.5 shrink-0" />
                    <span>
                        You are changing a skill that comes from GitHub. After you save, it keeps
                        your version and stops getting updates from {origin.repository}.
                    </span>
                </div>
            ) : null}
        </>
    )

    if (revisions.isError) {
        return (
            <div className="flex flex-col gap-4">
                {top}
                <div role="alert" className={`${NOTICE} bg-tag-red-bg text-tag-red`}>
                    <WarningCircle size={16} className="shrink-0" />
                    <span className="flex-1">We could not load this skill.</span>
                    <Button variant="outline" size="sm" onClick={() => void revisions.refetch()}>
                        Try again
                    </Button>
                </div>
            </div>
        )
    }

    if (!head || !base) {
        return (
            <div aria-busy className="flex flex-col gap-4">
                {top}
                <SkeletonBlock active className="h-9 w-1/3 rounded-md" />
                <SkeletonBlock active className="h-4 w-1/2 rounded" />
                <div className="mt-2 flex gap-6">
                    <SkeletonBlock active className="h-[420px] flex-[999_1_480px] rounded-[10px]" />
                    <SkeletonBlock active className="h-[420px] flex-[1_1_280px] rounded-[10px] max-sm:hidden" />
                </div>
            </div>
        )
    }

    return (
        <div className="flex animate-skill-enter flex-col gap-4">
            {top}
            <SkillEditor
                key={base?.id}
                draft={draft}
                onChange={edit}
                readOnly={archived}
                showMissing={attempted}
                actions={actions}
                meta={meta}
                notices={notices}
            />
            <SkillArchiveDialog
                projectId={projectId}
                skills={archiveTargets}
                onClose={() => setArchiveTargets([])}
                onArchived={(done) => {
                    setArchiveTargets([])
                    message.success(`${done[0]?.title} is archived. Restore any time from Archived.`)
                    onArchived(done)
                }}
            />
        </div>
    )
}

function AgentLink({
    agent,
    href,
}: {
    agent: {id: string; name: string}
    href?: (agentId: string) => string
}) {
    const body = (
        <>
            <span
                aria-hidden
                className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-[5px] border border-solid border-border bg-accent text-muted-foreground"
            >
                <Robot size={13} />
            </span>
            <span className="truncate">{agent.name}</span>
        </>
    )
    const cls =
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-foreground no-underline hover:bg-accent"
    return href && agent.id ? (
        <Link href={href(agent.id)} className={cls}>
            {body}
        </Link>
    ) : (
        <span className={cls}>{body}</span>
    )
}
