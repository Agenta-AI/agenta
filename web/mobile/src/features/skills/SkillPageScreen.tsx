import {useCallback, useMemo, useState} from "react"

import {createT, formatList, useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import skillsPageCatalog from "@agenta/i18n/catalogs/skills.page"
import {extractApiErrorMessage, timeAgo} from "@agenta/shared/utils"
import {
    commitSkillRevision,
    fetchSkillRevisions,
    querySkillReferencedBy,
    skillContentSchema,
} from "@agenta/skills"
import {invalidateSkillsListCache, skillsResolveDataAtom} from "@agenta/skills/state"
import {
    descriptionTooLong,
    draftSkillName,
    EMPTY_SKILL_DRAFT,
    sameSkillDraft,
    SkillEditor,
    SkillNameTitle,
    skillRevisionsQueryKey,
    skillTitle,
    skillUsageQueryKey,
    toSkillContent,
    toSkillDraft,
    useRegistrySkill,
    type SkillDraft,
} from "@agenta/skills-ui"
import {message} from "@agenta/ui/app-message"
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
    Button,
    SkeletonBlock,
} from "@agenta/ui/ui"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import Link from "next/link"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {PageLayout} from "../page-layout/PageLayout"
import {useConfirmModal} from "../settings/useConfirmModal"

import {SkillPageActions} from "./SkillPageActions"
import {SkillPageMeta} from "./SkillPageMeta"
import {skillPageHref, skillsListHref} from "./skillRoutes"
import {SkillPageSkeleton} from "./states/SkillPageSkeleton"
import {useSkillActions} from "./useSkillActions"
import {useSkillLeaveGuard} from "./useSkillLeaveGuard"
import {useSkillUpdates, useSkillUpdateStatus} from "./useSkillUpdates"

const tNow = createT(skillsPageCatalog)

/** One skill on its own page: the name, the meta line, the editor and the Files pane. */
export const SkillPageScreen = ({
    workspaceId,
    projectId,
    skillSlug,
}: {
    workspaceId: string
    projectId: string
    skillSlug: string
}) => {
    useBindProjectContext(projectId)
    const t = useT(skillsPageCatalog, commonCatalog)
    const base = `/w/${workspaceId}/p/${projectId}`
    const listHref = skillsListHref(base)
    const queryClient = useQueryClient()
    const {item, raw, query} = useRegistrySkill(skillSlug)
    const registry = useAtomValue(skillsResolveDataAtom)
    const workflowId = item?.id ?? ""
    const builtin = item?.origin === "builtin"
    const archived = Boolean(item?.archived)
    const readOnly = builtin || archived
    const origin = raw?.origin?.repository ? raw.origin : null

    const revisions = useQuery({
        queryKey: skillRevisionsQueryKey(projectId, workflowId),
        queryFn: () => fetchSkillRevisions({projectId, workflowId}),
        enabled: Boolean(projectId && workflowId) && !builtin,
        staleTime: 15_000,
    })
    const usage = useQuery({
        queryKey: skillUsageQueryKey(projectId, workflowId),
        queryFn: () => querySkillReferencedBy({projectId, workflowId}),
        enabled: Boolean(projectId && workflowId) && !builtin,
        staleTime: 15_000,
    })
    // Unknown while it loads or after it fails, so nothing claims "not used" by mistake.
    const usedBy = useMemo(
        () => (usage.isSuccess ? (usage.data?.referenced_by ?? []) : null),
        [usage.isSuccess, usage.data],
    )
    const head = revisions.data?.[0]

    // The draft seeds from the head; a newer head replaces it only while there are no edits.
    const [draft, setDraft] = useState<SkillDraft>(EMPTY_SKILL_DRAFT)
    const [baseline, setBaseline] = useState<{id: string; draft: SkillDraft} | null>(null)
    if (head && (!baseline || (baseline.id !== head.id && sameSkillDraft(draft, baseline.draft)))) {
        const seeded = toSkillDraft(head.skill)
        setBaseline({id: head.id, draft: seeded})
        setDraft(seeded)
    }
    const dirty = !readOnly && baseline !== null && !sameSkillDraft(draft, baseline.draft)
    const name = draftSkillName(draft)
    const canSave =
        Boolean(name) &&
        Boolean(draft.description.trim()) &&
        !descriptionTooLong(draft) &&
        Boolean(draft.body.trim())
    const duplicate = useMemo(
        () =>
            name && dirty
                ? registry.find(
                      (entry) =>
                          (entry.skill_name ?? entry.name) === name &&
                          entry.workflow_id !== workflowId &&
                          !entry.archived,
                  )
                : undefined,
        [dirty, name, registry, workflowId],
    )

    const {confirmDialog: leaveDialog} = useSkillLeaveGuard(dirty, t("skills.page.discardBody"))
    const confirmDialog = useConfirmModal()
    const {confirm} = confirmDialog
    const {archive, restore, download} = useSkillActions()
    const updates = useSkillUpdates()
    const updateStatus = useSkillUpdateStatus(workflowId)
    const [saving, setSaving] = useState(false)
    // A Save with something missing marks the fields, instead of a Save that is silently disabled.
    const [attempted, setAttempted] = useState(false)
    // The page header's slot for the editor's Files toggle (wide windows).
    const [filesSlot, setFilesSlot] = useState<HTMLDivElement | null>(null)

    const refetchHead = useCallback(
        () =>
            queryClient.invalidateQueries({
                queryKey: skillRevisionsQueryKey(projectId, workflowId),
            }),
        [projectId, queryClient, workflowId],
    )

    const commit = useCallback(async () => {
        if (!baseline) return
        const parsed = skillContentSchema.safeParse(toSkillContent(draft))
        if (!parsed.success) {
            message.error(tNow("skills.page.invalid"))
            return
        }
        setSaving(true)
        try {
            await commitSkillRevision({
                projectId,
                workflowId,
                skill: parsed.data,
                // A commit landed meanwhile conflicts instead of silently overwriting it.
                baseRevisionId: baseline.id,
            })
            invalidateSkillsListCache()
            // The saved draft is the new baseline, so the refetched head does not reseed it.
            const next = await queryClient.fetchQuery({
                queryKey: skillRevisionsQueryKey(projectId, workflowId),
                queryFn: () => fetchSkillRevisions({projectId, workflowId}),
                staleTime: 0,
            })
            const saved = next[0] ? toSkillDraft(next[0].skill) : draft
            setBaseline({id: next[0]?.id ?? baseline.id, draft: saved})
            setDraft(saved)
            setAttempted(false)
            message.success(tNow("skills.page.saved"))
        } catch (err) {
            message.error(extractApiErrorMessage(err) || tNow("skills.page.saveFailed"))
        } finally {
            setSaving(false)
        }
    }, [baseline, draft, projectId, queryClient, workflowId])

    const save = () => {
        if (!canSave) {
            setAttempted(true)
            return
        }
        if (origin && !origin.detached)
            confirm({
                title: t("skills.page.saveOwnTitle"),
                message: t("skills.page.saveOwnBody", {repository: origin.repository ?? ""}),
                okText: t("skills.page.save"),
                cancelText: t("skills.page.keepEditing"),
                // Not destructive: the primary button, not the red one (ACT-03).
                danger: false,
                onOk: commit,
            })
        else void commit()
    }

    const askArchive = () => {
        const agents = (usedBy ?? []).map((entry) => entry.agent_name ?? entry.agent_slug ?? "")
        confirm({
            title: t("skills.page.archiveTitle", {name: skillTitle(item ?? {name: "", slug: ""})}),
            message: agents.length
                ? t("skills.page.archiveUsedBody", {
                      count: agents.length,
                      agents: formatList(agents),
                  })
                : t("skills.page.archiveBody"),
            okText: t("skills.page.archive"),
            danger: true,
            onOk: async () => {
                await archive(workflowId)
                // Edits are dropped only once the archive went through.
                if (baseline) setDraft(baseline.draft)
            },
        })
    }

    const applyUpdate = async () => {
        if (dirty) return
        await updates.apply([workflowId])
        await refetchHead()
    }

    const edited = timeAgo(
        new Date(head?.createdAt ?? raw?.updated_at ?? raw?.created_at ?? "").getTime() ||
            undefined,
    )
    const displayName = item ? skillTitle(item) : skillSlug

    const notices = (
        <>
            {archived ? (
                <Alert
                    type="info"
                    showIcon
                    message={t("skills.page.archivedNotice")}
                    action={
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void restore(workflowId)}
                        >
                            {t("skills.page.restore")}
                        </Button>
                    }
                />
            ) : null}
            {builtin ? (
                <Alert type="info" showIcon message={t("skills.page.builtinNotice")} />
            ) : null}
            {duplicate?.workflow_slug ? (
                <Alert
                    type="warning"
                    showIcon
                    message={t("skills.page.duplicate", {name})}
                    action={
                        <Button size="sm" variant="outline" asChild>
                            <Link href={skillPageHref(base, duplicate.workflow_slug)}>
                                {t("skills.page.openIt")}
                            </Link>
                        </Button>
                    }
                />
            ) : null}
            {dirty && origin && !origin.detached ? (
                <Alert
                    type="info"
                    showIcon
                    message={t("skills.page.detachNotice", {repository: origin.repository ?? ""})}
                />
            ) : null}
        </>
    )

    let body: React.ReactNode
    const notFound = (
        <div className="flex flex-col items-center gap-3 py-16">
            <p className="m-0 text-center text-label text-muted-foreground">
                {t("skills.page.notFound")}
            </p>
            <Button variant="outline" asChild>
                <Link href={listHref}>{t("skills.page.backToSkills")}</Link>
            </Button>
        </div>
    )
    if (!item) {
        body = query.isPending ? (
            <SkillPageSkeleton />
        ) : query.isError ? (
            <Alert
                type="error"
                showIcon
                message={t("skills.page.loadFailed")}
                action={
                    <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
                        {t("skills.page.tryAgain")}
                    </Button>
                }
            />
        ) : (
            notFound
        )
    } else if (builtin) {
        body = (
            <SkillEditor
                key={item.id}
                draft={{...EMPTY_SKILL_DRAFT, name: item.name, description: item.description ?? ""}}
                onChange={() => undefined}
                readOnly
                notices={notices}
                filesToggleSlot={filesSlot}
            />
        )
    } else if (revisions.isSuccess && !head) {
        body = notFound
    } else if (revisions.isError) {
        body = (
            <Alert
                type="error"
                showIcon
                message={t("skills.page.loadFailed")}
                action={
                    <Button size="sm" variant="outline" onClick={() => void revisions.refetch()}>
                        {t("skills.page.tryAgain")}
                    </Button>
                }
            />
        )
    } else if (!baseline) {
        body = <SkillPageSkeleton />
    } else {
        body = (
            <SkillEditor
                key={item.id}
                draft={readOnly ? baseline.draft : draft}
                onChange={setDraft}
                readOnly={readOnly}
                notices={notices}
                showMissing={attempted}
                filesToggleSlot={filesSlot}
            />
        )
    }

    return (
        <>
            <PageLayout
                workspaceId={workspaceId}
                projectId={projectId}
                width="md"
                back={{label: t("skills.page.skills"), href: listHref}}
                documentTitle={t("skills.page.skills")}
                documentContext={displayName}
                title={
                    baseline || builtin ? (
                        <SkillNameTitle
                            value={
                                builtin
                                    ? displayName
                                    : readOnly
                                      ? (baseline?.draft.name ?? "")
                                      : draft.name
                            }
                            onChange={(next) => setDraft((current) => ({...current, name: next}))}
                            readOnly={readOnly}
                            invalid={!readOnly && attempted && !name}
                        />
                    ) : query.isPending ? (
                        // A bar in the title's place, so the slug does not flash in before the name.
                        <SkeletonBlock className="h-7 w-48" />
                    ) : (
                        displayName
                    )
                }
                description={
                    item ? (
                        <SkillPageMeta
                            base={base}
                            origin={origin}
                            usedBy={usedBy}
                            edited={edited}
                            updateAvailable={updateStatus === "available"}
                            updateBlocked={dirty}
                            onApplyUpdate={() => void applyUpdate()}
                        />
                    ) : undefined
                }
                actions={
                    item ? (
                        <>
                            <SkillPageActions
                                filesSlot={<div ref={setFilesSlot} className="flex empty:hidden" />}
                                editable={!readOnly && Boolean(baseline)}
                                dirty={dirty}
                                canSave={canSave}
                                saving={saving}
                                archived={archived}
                                builtin={builtin}
                                origin={origin}
                                onDiscard={() => baseline && setDraft(baseline.draft)}
                                onSave={save}
                                onCheck={() => void updates.check([workflowId])}
                                onDownload={() => void download(workflowId)}
                                onArchive={askArchive}
                                onRestore={() => void restore(workflowId)}
                            />
                        </>
                    ) : undefined
                }
            >
                {body}
            </PageLayout>
            <AlertDialog
                open={Boolean(confirmDialog.request)}
                onOpenChange={(next) => {
                    if (!next && !confirmDialog.pending) confirmDialog.close()
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{confirmDialog.request?.title ?? ""}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmDialog.request?.message ?? ""}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {confirmDialog.error ? (
                        <p className="m-0 text-body text-destructive">{confirmDialog.error}</p>
                    ) : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button
                                variant="outline"
                                onClick={confirmDialog.close}
                                disabled={confirmDialog.pending}
                            >
                                {confirmDialog.request?.cancelText ?? t("common.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button
                                variant={
                                    confirmDialog.request?.danger === false
                                        ? "default"
                                        : "destructive"
                                }
                                disabled={confirmDialog.pending}
                                onClick={(event) => {
                                    event.preventDefault()
                                    void confirmDialog.runConfirm()
                                }}
                            >
                                {confirmDialog.pending
                                    ? t("common.working")
                                    : (confirmDialog.request?.okText ?? t("common.confirm"))}
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <AlertDialog
                open={Boolean(leaveDialog.request)}
                onOpenChange={(next) => {
                    if (!next && !leaveDialog.pending) leaveDialog.close()
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{leaveDialog.request?.title ?? ""}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {leaveDialog.request?.message ?? ""}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {leaveDialog.error ? (
                        <p className="m-0 text-body text-destructive">{leaveDialog.error}</p>
                    ) : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button
                                variant="outline"
                                onClick={leaveDialog.close}
                                disabled={leaveDialog.pending}
                            >
                                {leaveDialog.request?.cancelText ?? t("common.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button
                                variant={
                                    leaveDialog.request?.danger === false
                                        ? "default"
                                        : "destructive"
                                }
                                disabled={leaveDialog.pending}
                                onClick={(event) => {
                                    event.preventDefault()
                                    void leaveDialog.runConfirm()
                                }}
                            >
                                {leaveDialog.pending
                                    ? t("common.working")
                                    : (leaveDialog.request?.okText ?? t("common.confirm"))}
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
