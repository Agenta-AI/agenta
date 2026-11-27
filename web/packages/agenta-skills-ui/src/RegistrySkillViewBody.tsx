/**
 * The body of the skill view for a registry skill (F07 f9). The agent's skill view renders it for
 * an `@ag.embed` entry (through the skills bridge), and the Skills page mounts it through
 * `registrySkillView`. Save commits a new revision in the skill registry with the revision the
 * edit started from as its base; the agent configuration does not change.
 *
 * Mounted for an agent (target `agent_draft`): the status line links to the Skills page. Mounted on
 * the Skills page (target `project`): the header adds "Used by" and the menu adds "Add to agent".
 */
import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from "react"

import type {RegistrySkillParams} from "@agenta/editor/drill-in"
import {AgentChip} from "@agenta/entity-ui/agent"
import {
    firstBadFile,
    SKILL_ACTION_ROW,
    SkillBodySkeleton,
    SkillViewHeader,
    SkillViewSkeleton,
    useSkillViewForm,
    skillFilesOf,
    useSkillDownloadAction,
    type SkillAction,
} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import skillViewCatalog from "@agenta/i18n/catalogs/entityUi.skillView"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import skillsGalleryCatalog from "@agenta/i18n/catalogs/skills.gallery"
import skillsPageCatalog from "@agenta/i18n/catalogs/skills.page"
import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {timeAgo} from "@agenta/shared/utils"
import {
    archiveSkill,
    commitSkillRevision,
    fetchSkillRevisions,
    querySkillReferencedBy,
    skillContentSchema,
    unarchiveSkill,
} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {message} from "@agenta/ui/app-message"
import {cn} from "@agenta/ui/styles"
import {
    Alert,
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Badge,
    Button,
    Popover,
    PopoverAnchor,
    PopoverContent,
    SkeletonBlock,
    Spinner,
} from "@agenta/ui/ui"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {Archive, ArrowUUpLeft, Plus} from "@phosphor-icons/react"
import {useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import {SkillAgentPicker, skillUsageQueryKey} from "./SkillAgentPicker"
import {skillNameProblem, toSkillContent, toSkillDraft, type SkillDraft} from "./skillDraft"
import {SkillEditor} from "./SkillEditor"
import {skillTitle} from "./skillTitle"
import type {SkillListItem, SkillUsageRef} from "./types"
import {useRegistrySkill} from "./useRegistrySkill"

/** The head-revision query's key; the registry row's Download reads the same cache. */
export const skillRevisionsQueryKey = (projectId: string, workflowId: string) =>
    ["skills", "revisions", projectId, workflowId] as const

/** Where an agent's name in "Used by" leads, given by the Skills page. */
export const SkillAgentHrefContext = createContext<((agentId: string) => string) | null>(null)

/** The Skills page with this skill open, in this project: the "skill registry" link. */
/** The editor's draft back as the form value, the name kept as typed. */
const fromDraft = (draft: SkillDraft): Record<string, unknown> => ({
    name: draft.name,
    description: draft.description,
    body: draft.body,
    files: draft.files,
    allow_executable_files: draft.allowExecutable,
    ...(draft.disableModelInvocation != null
        ? {disable_model_invocation: draft.disableModelInvocation}
        : {}),
})

/** Open on hover, close a beat after the pointer leaves, so crossing a gap does not shut it. */
const useHoverOpen = () => {
    const [open, setOpen] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const clear = () => {
        if (timer.current) clearTimeout(timer.current)
    }
    useEffect(() => clear, [])
    const show = useCallback(() => {
        clear()
        setOpen(true)
    }, [])
    const scheduleHide = useCallback(() => {
        clear()
        timer.current = setTimeout(() => setOpen(false), 120)
    }, [])
    return {open, setOpen, show, scheduleHide}
}

const RegistrySkillViewBody = ({params, target, nav, readOnly}: ViewProps<RegistrySkillParams>) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const {item, query} = useRegistrySkill(params.slug)
    useViewTitle(item ? skillTitle(item) : params.slug)

    if (!item) {
        return query.isPending ? (
            <SkillViewSkeleton />
        ) : (
            <LoadFailed onRetry={() => void query.refetch()} />
        )
    }
    return (
        <RegistrySkillEditor
            key={item.id}
            skill={item}
            projectId={projectId}
            inAgent={target.kind === "agent_draft"}
            nav={nav}
            viewReadOnly={Boolean(readOnly)}
        />
    )
}

const LoadFailed = ({onRetry}: {onRetry: () => void}) => {
    const t = useT(skillsGalleryCatalog)
    return (
        <div className="p-4">
            <Alert
                type="error"
                showIcon
                message={t("skills.gallery.loadFailed")}
                description={t("skills.gallery.loadFailedHint")}
                action={
                    <Button variant="outline" size="sm" onClick={onRetry}>
                        {t("skills.gallery.tryAgain")}
                    </Button>
                }
            />
        </div>
    )
}

const RegistrySkillEditor = ({
    skill,
    projectId,
    inAgent,
    nav,
    viewReadOnly,
}: {
    skill: SkillListItem
    projectId: string
    inAgent: boolean
    nav: ViewProps<RegistrySkillParams>["nav"]
    /** The host shows the view read only (a phone): no edit, no archive, no restore. */
    viewReadOnly: boolean
}) => {
    const t = useT(skillsGalleryCatalog, skillViewCatalog, skillsEditorCatalog, skillsPageCatalog)
    // Leave without a question: after an archive or a restore there is nothing left to save.
    const onLeave = nav.cancel
    const agentHref = useContext(SkillAgentHrefContext)
    // The list item's id IS the workflow id.
    const workflowId = skill.id
    const isBuiltin = skill.origin === "builtin"
    const readOnly = viewReadOnly || isBuiltin || Boolean(skill.archived)

    const revisionsQuery = useQuery({
        queryKey: skillRevisionsQueryKey(projectId, workflowId),
        queryFn: () => fetchSkillRevisions({projectId, workflowId}),
        enabled: Boolean(projectId && workflowId) && !isBuiltin,
        staleTime: 15_000,
    })
    const usageQuery = useQuery({
        queryKey: skillUsageQueryKey(projectId, workflowId),
        queryFn: () => querySkillReferencedBy({projectId, workflowId}),
        enabled: Boolean(projectId && workflowId) && !isBuiltin,
        staleTime: 15_000,
    })
    const head = revisionsQuery.data?.[0]
    const usedBy = useMemo<SkillUsageRef[]>(
        () =>
            (usageQuery.data?.referenced_by ?? []).map((entry) => ({
                id: entry.agent_workflow_id ?? entry.agent_slug ?? "",
                name: entry.agent_name ?? entry.agent_slug ?? "",
                mode: entry.mode ?? "latest",
                pinnedVersion: entry.pinned_version?.replace(/^v/, "") ?? undefined,
            })),
        [usageQuery.data],
    )

    // The draft seeds from the head once. The revision it started from is the concurrency base,
    // captured at seeding: a background refetch can move the head while the view is open.
    const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
    const [editBaseId, setEditBaseId] = useState<string | null>(null)
    if (head && draft === null) {
        setDraft(fromDraft(toSkillDraft(head.skill)))
        setEditBaseId(head.id)
    }
    const headValue = useMemo(() => fromDraft(toSkillDraft(head?.skill)), [head])
    // Read only shows the saved skill, never a draft typed before the view turned read only.
    const value = readOnly ? headValue : (draft ?? headValue)
    const dirty = !readOnly && draft !== null && JSON.stringify(draft) !== JSON.stringify(headValue)
    const valid =
        !readOnly &&
        skillContentSchema.safeParse(toSkillContent(toSkillDraft(value))).success &&
        firstBadFile(skillFilesOf(value)) === undefined
    const [error, setError] = useState<string | null>(null)

    useSkillViewForm(
        {
            dirty,
            valid,
            // Read only (archived, built-in, a phone): nothing to save, so no Cancel and Save row.
            ...(readOnly ? {actionRow: false as const} : {}),
            save: async () => {
                // The stored name is the typed name's slug, as the skill page saves it.
                const parsed = skillContentSchema.safeParse(toSkillContent(toSkillDraft(value)))
                if (!parsed.success || !editBaseId) return false
                setError(null)
                try {
                    await commitSkillRevision({
                        projectId,
                        workflowId,
                        skill: parsed.data,
                        // A commit landed meanwhile conflicts instead of silently overwriting it.
                        baseRevisionId: editBaseId,
                    })
                } catch (err) {
                    setError(
                        err instanceof Error && err.message
                            ? t("skills.gallery.saveFailedDetail", {error: err.message})
                            : t("skills.gallery.saveFailed"),
                    )
                    return false
                }
                invalidateSkillsListCache()
                // The next open loads the new head.
                void getHostQueryClient().invalidateQueries({
                    queryKey: skillRevisionsQueryKey(projectId, workflowId),
                })
                return true
            },
        },
        t("entityUi.skillView.upload"),
    )

    // Archive keeps the slug reserved; the registry hides the skill until it is restored.
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [archiveBusy, setArchiveBusy] = useState(false)
    const [archiveError, setArchiveError] = useState<string | null>(null)
    const runArchive = useCallback(
        async (restore: boolean) => {
            setArchiveBusy(true)
            setArchiveError(null)
            try {
                if (restore) await unarchiveSkill({projectId, workflowId})
                else await archiveSkill({projectId, workflowId})
                invalidateSkillsListCache()
                setArchiveOpen(false)
                if (restore) message.success(t("skills.page.restored"))
                onLeave()
            } catch (err) {
                setArchiveError(
                    err instanceof Error && err.message
                        ? err.message
                        : t(
                              restore
                                  ? "skills.gallery.unarchiveFailed"
                                  : "skills.gallery.archiveFailed",
                          ),
                )
            } finally {
                setArchiveBusy(false)
            }
        },
        [onLeave, projectId, t, workflowId],
    )

    // The header's slot for the editor's Files toggle.
    const [filesSlot, setFilesSlot] = useState<HTMLDivElement | null>(null)
    // Flyouts render inside the view, so a modal drawer around it keeps their lists scrollable.
    const [editorRoot, setEditorRoot] = useState<HTMLDivElement | null>(null)
    // "Add to agent" opens the agent picker as a flyout, on hover as the filter menu rows do.
    const [menuOpen, setMenuOpen] = useState(false)
    const {
        open: agentsOpen,
        setOpen: setAgentsOpen,
        show: openAgents,
        scheduleHide: scheduleCloseAgents,
    } = useHoverOpen()
    const addToAgent =
        !inAgent && !readOnly ? (
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
                        className={cn(SKILL_ACTION_ROW, agentsOpen && "bg-accent")}
                    >
                        <Plus aria-hidden size={14} className="text-muted-foreground" />
                        <span className="flex-1">{t("skills.gallery.addToAgent")}</span>
                    </button>
                </PopoverAnchor>
                <PopoverContent
                    side="left"
                    align="start"
                    sideOffset={6}
                    aria-label={t("skills.gallery.addToAgent")}
                    container={editorRoot}
                    className="flex w-[280px] flex-col gap-0 p-0"
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    onMouseEnter={openAgents}
                    onMouseLeave={scheduleCloseAgents}
                >
                    <SkillAgentPicker projectId={projectId} skill={skill} />
                </PopoverContent>
            </Popover>
        ) : null

    const download = useSkillDownloadAction(value)
    const actions: SkillAction[] = isBuiltin
        ? []
        : viewReadOnly
          ? download
          : [
                ...download,
                ...(!skill.archived
                    ? [
                          {
                              key: "archive",
                              label: t("skills.gallery.archive"),
                              icon: <Archive size={14} />,
                              danger: true,
                              onSelect: () => setArchiveOpen(true),
                          },
                      ]
                    : []),
            ]

    const status = isBuiltin ? (
        <span>{t("skills.gallery.builtinReadOnly")}</span>
    ) : skill.archived ? (
        t("skills.gallery.archived")
    ) : null

    // While the usage loads its line keeps its place, so the fields do not move when it lands.
    const usage = !usageQuery.data ? (
        usageQuery.isLoading ? (
            <SkeletonBlock className="h-3 w-28" />
        ) : null
    ) : usedBy.length ? (
        <UsedBy
            container={editorRoot}
            usedBy={usedBy}
            agentHref={agentHref}
            dirty={dirty}
            onLeave={onLeave}
            onAskLeave={nav.back}
        />
    ) : inAgent ? null : (
        // This agent's unsaved draft may use the skill, so the agent view does not say "not used".
        <span>{t("skills.page.notUsed")}</span>
    )
    const editedAt = head?.createdAt ? new Date(head.createdAt).getTime() : NaN
    const edited = Number.isNaN(editedAt) ? "" : timeAgo(editedAt)
    // "Used by · Edited" under the name, as on the Skills page.
    const meta =
        !isBuiltin && (usage || edited) ? (
            <div className="flex min-h-6 shrink-0 flex-wrap items-center gap-x-1.5 px-4 pb-2 text-meta text-muted-foreground">
                {usage}
                {usage && edited ? <span aria-hidden>·</span> : null}
                {edited ? <span>{t("skills.page.edited", {age: edited})}</span> : null}
            </div>
        ) : null

    return (
        <div ref={setEditorRoot} className="flex min-h-0 flex-1 flex-col">
            <SkillViewHeader
                // The name is the view's title, edited in place, as on the skill page.
                editable={
                    readOnly
                        ? undefined
                        : {
                              value: toSkillDraft(value).name,
                              onChange: (name) => setDraft({...value, name}),
                              "aria-label": t("skills.editor.name"),
                              placeholder: t("skills.editor.namePlaceholder"),
                              error:
                                  skillNameProblem(toSkillDraft(value).name) === "invalid"
                                      ? t("skills.editor.nameInvalid")
                                      : dirty && !valid && !toSkillDraft(value).name.trim()
                                        ? t("skills.editor.nameMissing")
                                        : undefined,
                          }
                }
                extra={
                    skill.archived ? (
                        <Badge className="shrink-0">{t("skills.gallery.archived")}</Badge>
                    ) : null
                }
                end={<div ref={setFilesSlot} className="flex empty:hidden" />}
                name={skillTitle(skill)}
                status={status}
                actions={actions}
                menuTop={addToAgent}
                menuOpen={menuOpen}
                onMenuOpenChange={(next) => {
                    setMenuOpen(next)
                    if (!next) setAgentsOpen(false)
                }}
                busy={archiveBusy}
                error={error ?? (archiveOpen ? null : archiveError)}
            />
            {meta}
            {skill.archived && !isBuiltin && !viewReadOnly ? (
                <div className="flex shrink-0 items-center gap-2 px-4 pb-3">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void runArchive(true)}
                        disabled={archiveBusy}
                    >
                        {archiveBusy ? (
                            <Spinner size="small" />
                        ) : (
                            <ArrowUUpLeft aria-hidden size={14} />
                        )}
                        {t("skills.gallery.restore")}
                    </Button>
                </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col">
                {isBuiltin ? (
                    <div className="mx-4 flex flex-col gap-2 rounded-md border border-solid border-border-muted bg-secondary p-4 text-label font-normal">
                        <span className="text-muted-foreground">
                            {skill.description || t("skills.gallery.noDescriptionDot")}
                        </span>
                        <span className="text-muted-foreground">
                            {t("skills.gallery.builtinNote")}
                        </span>
                    </div>
                ) : revisionsQuery.isPending ? (
                    <SkillBodySkeleton />
                ) : revisionsQuery.isError || !head ? (
                    <LoadFailed onRetry={() => void revisionsQuery.refetch()} />
                ) : (
                    // The same editor as the skill page, with Files beside or over the fields.
                    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4 pt-3">
                        <SkillEditor
                            draft={toSkillDraft(value)}
                            onChange={(next) => setDraft(fromDraft(next))}
                            readOnly={readOnly}
                            showMissing={dirty && !valid}
                            filesPlacement="inline"
                            filesToggleSlot={filesSlot}
                        />
                    </div>
                )}
            </div>

            <AlertDialog
                open={archiveOpen}
                onOpenChange={(next) => {
                    if (!next && !archiveBusy) setArchiveOpen(false)
                }}
            >
                <AlertDialogContent
                    onEscapeKeyDown={(event) => {
                        if (archiveBusy) event.preventDefault()
                    }}
                >
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t("skills.gallery.archiveTitle", {name: skillTitle(skill)})}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("skills.gallery.archiveBody")}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {usedBy.length ? (
                        <Alert
                            type="warning"
                            showIcon
                            message={t("skills.gallery.agentsReference", {count: usedBy.length})}
                        />
                    ) : null}
                    {archiveError ? (
                        <p className="m-0 text-label font-normal text-destructive">
                            {archiveError}
                        </p>
                    ) : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button variant="outline" disabled={archiveBusy}>
                                {t("skills.gallery.cancel")}
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
                                    void runArchive(false)
                                }}
                            >
                                {archiveBusy ? <Spinner size="small" /> : null}
                                {t("skills.gallery.archiveSkill")}
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

/** "Used by N agents" on the Skills page; the names wait behind a hover, each a link to its agent. */
const UsedBy = ({
    container,
    usedBy,
    agentHref,
    dirty,
    onLeave,
    onAskLeave,
}: {
    container: HTMLElement | null
    usedBy: SkillUsageRef[]
    agentHref: ((agentId: string) => string) | null
    dirty: boolean
    onLeave: () => void
    /** The guarded way out: asks first about the edits; resolves true when the view closed. */
    onAskLeave: () => Promise<boolean>
}) => {
    const t = useT(skillsGalleryCatalog)
    const router = useRouter()
    const {open, setOpen, show, scheduleHide} = useHoverOpen()
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverAnchor asChild>
                <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    onClick={show}
                    onMouseEnter={show}
                    onMouseLeave={scheduleHide}
                    className="box-border inline-flex shrink-0 cursor-default items-center border-0 bg-transparent p-0 font-[inherit] text-meta font-normal text-muted-foreground hover:text-muted-foreground"
                >
                    {t("skills.gallery.usedBy", {count: usedBy.length})}
                </button>
            </PopoverAnchor>
            <PopoverContent
                side="bottom"
                align="start"
                sideOffset={6}
                aria-label={t("skills.gallery.agentsUsingAria")}
                container={container}
                className="flex w-[240px] flex-col gap-px p-1"
                onOpenAutoFocus={(event) => event.preventDefault()}
                onMouseEnter={show}
                onMouseLeave={scheduleHide}
            >
                {usedBy.map((agent) => {
                    const label = (
                        <>
                            <AgentChip workflowId={agent.id} box="size-5" glyph={13} />
                            <span className="min-w-0 flex-1 truncate">
                                {agent.name || t("skills.gallery.unknownAgent")}
                            </span>
                            <span className="shrink-0 text-caption text-muted-foreground">
                                {agent.mode === "pinned"
                                    ? t("skills.gallery.pinned", {
                                          version: agent.pinnedVersion ?? "",
                                      })
                                    : t("skills.gallery.latest")}
                            </span>
                        </>
                    )
                    // With edits the link asks first, and goes on once the person saved or discarded.
                    const href = agentHref?.(agent.id)
                    return href ? (
                        <Link
                            key={agent.id}
                            href={href}
                            onClick={(event) => {
                                if (!dirty) return onLeave()
                                event.preventDefault()
                                void onAskLeave().then((left) => {
                                    if (left) void router.push(href)
                                })
                            }}
                            className={cn(SKILL_ACTION_ROW, "no-underline")}
                        >
                            {label}
                        </Link>
                    ) : (
                        <span key={agent.id} className={cn(SKILL_ACTION_ROW, "cursor-default")}>
                            {label}
                        </span>
                    )
                })}
            </PopoverContent>
        </Popover>
    )
}

export default RegistrySkillViewBody
