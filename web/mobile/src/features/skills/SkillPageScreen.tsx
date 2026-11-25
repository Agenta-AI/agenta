import {useCallback, useMemo, useState} from "react"

import {createT, useT} from "@agenta/i18n"
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
import {Alert, Button} from "@agenta/ui/ui"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import Link from "next/link"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {PageLayout} from "../page-layout/PageLayout"
import {useConfirmModal} from "../settings/useConfirmModal"

import {SkillPageActions} from "./SkillPageActions"
import {SkillPageMeta} from "./SkillPageMeta"
import {SkillPageSkeleton} from "./states/SkillPageSkeleton"
import {skillPageHref, skillsListHref} from "./skillRoutes"
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
    const t = useT(skillsPageCatalog)
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
    const usedBy = useMemo(() => usage.data?.referenced_by ?? [], [usage.data])
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

    const {modal: leaveModal} = useSkillLeaveGuard(dirty, t("skills.page.discardBody"))
    const {confirm, modal} = useConfirmModal()
    const {archive, restore, download} = useSkillActions()
    const updates = useSkillUpdates()
    const updateStatus = useSkillUpdateStatus(workflowId)
    const [saving, setSaving] = useState(false)
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
            message.success(tNow("skills.page.saved"))
        } catch (err) {
            message.error(extractApiErrorMessage(err) || tNow("skills.page.saveFailed"))
        } finally {
            setSaving(false)
        }
    }, [baseline, draft, projectId, queryClient, workflowId])

    const save = () => {
        if (origin && !origin.detached)
            confirm({
                title: t("skills.page.saveOwnTitle"),
                message: t("skills.page.saveOwnBody", {repository: origin.repository ?? ""}),
                okText: t("skills.page.save"),
                cancelText: t("skills.page.keepEditing"),
                onOk: commit,
            })
        else void commit()
    }

    const askArchive = () => {
        const agents = usedBy.map((entry) => entry.agent_name ?? entry.agent_slug ?? "")
        confirm({
            title: t("skills.page.archiveTitle", {name: skillTitle(item ?? {name: "", slug: ""})}),
            message: agents.length
                ? t("skills.page.archiveUsedBody", {
                      count: agents.length,
                      agents: agents.join(", "),
                  })
                : t("skills.page.archiveBody"),
            okText: t("skills.page.archive"),
            danger: true,
            onOk: async () => {
                if (baseline) setDraft(baseline.draft)
                await archive(workflowId)
            },
        })
    }

    const applyUpdate = async () => {
        if (dirty) {
            message.error(t("skills.page.saveFirst"))
            return
        }
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
    if (!item) {
        body = query.isPending ? (
            <SkillPageSkeleton />
        ) : (
            <p className="m-0 py-16 text-center text-label text-muted-foreground">
                {t("skills.page.notFound")}
            </p>
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
    } else if (revisions.isError || (revisions.isSuccess && !head)) {
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
                            invalid={!readOnly && !name}
                        />
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
            {modal}
            {leaveModal}
        </>
    )
}
