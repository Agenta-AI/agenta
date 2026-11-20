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

import {AgentChip} from "@agenta/entity-ui/agent"
import {
    firstBadFile,
    SKILL_ACTION_ROW,
    SkillFormSkeleton,
    SkillFormView,
    SkillViewHeader,
    skillFilesOf,
    useSkillDownloadAction,
    type SkillAction,
} from "@agenta/entity-ui/drill-in"
import {richText, useT} from "@agenta/i18n"
import skillViewCatalog from "@agenta/i18n/catalogs/entityUi.skillView"
import skillsGalleryCatalog from "@agenta/i18n/catalogs/skills.gallery"
import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {
    archiveSkill,
    commitSkillRevision,
    fetchSkillRevisions,
    querySkillReferencedBy,
    skillContentSchema,
    unarchiveSkill,
} from "@agenta/skills"
import {invalidateSkillsListCache, skillsResolveQueryAtom} from "@agenta/skills/state"
import type {RegistrySkillParams} from "@agenta/ui/drill-in"
import {cn} from "@agenta/ui/styles"
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
    Popover,
    PopoverAnchor,
    PopoverContent,
    Spinner,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {Archive, ArrowUUpLeft, Info, Lightning, Plus, WarningCircle} from "@phosphor-icons/react"
import {useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import {toSkillListItem, toSourceInfo} from "./registrySections"
import {SkillAgentPicker, skillUsageQueryKey} from "./SkillAgentPicker"
import {skillTitle} from "./skillTitle"
import type {SkillListItem, SkillUsageRef} from "./types"

/** The head-revision query's key; the registry row's Download reads the same cache. */
export const skillRevisionsQueryKey = (projectId: string, workflowId: string) =>
    ["skills", "revisions", projectId, workflowId] as const

/** Where an agent's name in "Used by" leads, given by the Skills page. */
export const SkillAgentHrefContext = createContext<((agentId: string) => string) | null>(null)

/** The Skills page with this skill open, in this project: the "skill registry" link. */
const skillsPageHref = (slug: string): string | null => {
    if (typeof window === "undefined") return null
    const project = window.location.pathname.match(/^(.*?\/p\/[^/]+)/)?.[1]
    return project ? `${project}/skills?skill=${encodeURIComponent(slug)}` : null
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

/** The registry entry with this workflow slug: project skills (archived too), then built-ins. */
const useRegistrySkill = (slug: string) => {
    const query = useAtomValue(skillsResolveQueryAtom)
    const item = useMemo<SkillListItem | null>(() => {
        const matches = (entry: {workflow_slug?: string | null}) => entry.workflow_slug === slug
        const project = query.data?.skills?.find(matches)
        if (project) {
            const mapped = toSkillListItem(project, project.origin ? "imported" : "project")
            return project.origin ? {...mapped, source: toSourceInfo(project.origin)} : mapped
        }
        const builtin = query.data?.builtin?.find(matches)
        return builtin ? toSkillListItem(builtin, "builtin") : null
    }, [query.data, slug])
    return {item, query}
}

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
        timer.current = setTimeout(() => setOpen(false), 140)
    }, [])
    return {open, setOpen, show, scheduleHide}
}

const RegistrySkillViewBody = ({params, target, nav, readOnly}: ViewProps<RegistrySkillParams>) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const {item, query} = useRegistrySkill(params.slug)
    useViewTitle(item ? skillTitle(item) : params.slug)

    if (!item) {
        return query.isPending ? (
            <div className="flex min-h-0 flex-1 flex-col p-4">
                <SkillFormSkeleton />
            </div>
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
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <WarningCircle size={20} className="text-[var(--ag-colorError)]" />
            <span className="text-sm">{t("skills.gallery.loadFailed")}</span>
            <Button variant="outline" size="sm" onClick={onRetry}>
                {t("skills.gallery.tryAgain")}
            </Button>
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
    const t = useT(skillsGalleryCatalog, skillViewCatalog)
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
        setDraft(toFormValue(head.skill))
        setEditBaseId(head.id)
    }
    const headValue = useMemo(() => toFormValue(head?.skill), [head])
    const value = draft ?? headValue
    const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(headValue)
    const valid =
        !readOnly &&
        skillContentSchema.safeParse(value).success &&
        firstBadFile(skillFilesOf(value)) === undefined
    const [error, setError] = useState<string | null>(null)

    useViewForm({
        dirty,
        valid,
        leaveDescription: t("entityUi.skillView.registryLeaveDescription"),
        save: async () => {
            const parsed = skillContentSchema.safeParse(value)
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
    })

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

    const registryLink = skill.workflowSlug ? skillsPageHref(skill.workflowSlug) : null
    const status = isBuiltin ? (
        <span className="flex items-center gap-0.5">
            <Lightning size={10} weight="fill" />
            {t("skills.gallery.builtinReadOnly")}
        </span>
    ) : inAgent ? (
        richText(t("entityUi.skillView.registryStatus"), {
            link: (text) =>
                registryLink ? (
                    <a
                        href={registryLink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-inherit underline underline-offset-2"
                    >
                        {text}
                    </a>
                ) : (
                    text
                ),
        })
    ) : skill.archived ? (
        t("skills.gallery.archived")
    ) : null

    // Where an imported skill came from, behind an info mark beside the name.
    const provenance = skill.source ? (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        aria-label={t("skills.gallery.provenanceAria")}
                        className="box-border inline-flex shrink-0 cursor-help items-center border-0 bg-transparent p-0 font-[inherit] text-[var(--ag-colorTextTertiary)] hover:text-[var(--ag-colorText)]"
                    >
                        <Info size={14} aria-hidden />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start">
                    <span className="flex flex-col gap-0.5">
                        <span>
                            {richText(
                                t("skills.gallery.importedFrom", {source: skill.source.label}),
                                {mono: (text) => <span className="font-mono">{text}</span>},
                            )}
                        </span>
                        {skill.source.detached ? (
                            <span className="opacity-80">
                                {t("skills.gallery.modifiedLocally")}
                            </span>
                        ) : null}
                    </span>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    ) : null

    const usage =
        !inAgent && usedBy.length ? (
            <UsedBy
                container={editorRoot}
                usedBy={usedBy}
                agentHref={agentHref}
                dirty={dirty}
                onLeave={onLeave}
                onAskLeave={nav.back}
            />
        ) : null

    return (
        <div ref={setEditorRoot} className="flex min-h-0 flex-1 flex-col">
            <SkillViewHeader
                name={skillTitle(skill)}
                status={status}
                extra={
                    <>
                        {provenance}
                        {usage}
                    </>
                }
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
                    <div className="mx-4 flex flex-col gap-2 rounded-md border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)] p-4 text-xs">
                        <span className="text-[var(--ag-colorTextSecondary)]">
                            {skill.description || t("skills.gallery.noDescriptionDot")}
                        </span>
                        <span className="text-[var(--ag-colorTextTertiary)]">
                            {t("skills.gallery.builtinNote")}
                        </span>
                    </div>
                ) : revisionsQuery.isPending ? (
                    <div className="flex min-h-0 flex-1 flex-col px-4">
                        <SkillFormSkeleton />
                    </div>
                ) : revisionsQuery.isError || !head ? (
                    <LoadFailed onRetry={() => void revisionsQuery.refetch()} />
                ) : (
                    <SkillFormView
                        value={value}
                        onChange={readOnly ? () => undefined : setDraft}
                        baseline={headValue}
                        downloadable
                        disabled={readOnly}
                        showMissing={dirty && !valid}
                    />
                )}
            </div>

            <AlertDialog
                open={archiveOpen}
                onOpenChange={(next) => {
                    if (!next && !archiveBusy) setArchiveOpen(false)
                }}
            >
                <AlertDialogContent
                    className="sm:max-w-[440px]"
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
                        <div className="flex items-start gap-1.5 rounded-md border border-solid border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] px-3 py-2 text-xs text-[var(--ag-colorWarningText)]">
                            <WarningCircle size={14} className="mt-px shrink-0" />
                            <span>
                                {t("skills.gallery.agentsReference", {count: usedBy.length})}
                            </span>
                        </div>
                    ) : null}
                    {archiveError ? (
                        <p className="m-0 text-xs text-[var(--ag-colorError)]">{archiveError}</p>
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
                    className="box-border inline-flex shrink-0 cursor-default items-center border-0 bg-transparent p-0 font-[inherit] text-[12px] font-normal text-[var(--ag-colorTextTertiary)] hover:text-[var(--ag-colorTextSecondary)]"
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
                            <span className="shrink-0 text-[11px] text-[var(--ag-colorTextTertiary)]">
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
