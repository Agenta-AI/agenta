import {useCallback, useEffect, useRef, useState} from "react"

import {useT} from "@agenta/i18n"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import skillsPageCatalog from "@agenta/i18n/catalogs/skills.page"
import {
    SkillCandidateList,
    SkillCreateWays,
    SkillEditor,
    SkillNameTitle,
    SkillGithubImport,
    useSkillCreateFlow,
    type CreatedSkill,
    type ImportedSkill,
} from "@agenta/skills-ui"
import {Alert, Button, IconTile, LoadingButton} from "@agenta/ui/ui"
import {GithubLogo} from "@phosphor-icons/react"
import {useAtom} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {PageLayout} from "../page-layout/PageLayout"

import {pendingSkillUploadAtom} from "./pendingSkillUpload"
import {skillPageHref, skillsListHref} from "./skillRoutes"
import {useSkillLeaveGuard} from "./useSkillLeaveGuard"

/** New skill: the ways in, then the editor, the upload picks or the GitHub import. */
export const SkillCreateScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const t = useT(skillsPageCatalog, skillsEditorCatalog)
    const router = useRouter()
    const base = `/w/${workspaceId}/p/${projectId}`
    const listHref = skillsListHref(base)
    const [pendingUpload, setPendingUpload] = useAtom(pendingSkillUploadAtom)

    // One new skill opens its page; several go back to the list, marked fresh.
    const leaveRef = useRef<(url: string) => void>(() => undefined)
    const showAdded = useCallback(
        (skills: (CreatedSkill | ImportedSkill)[]) => {
            const slugs = skills.flatMap((skill) =>
                skill.workflowSlug ? [skill.workflowSlug] : [],
            )
            leaveRef.current(
                slugs.length === 1
                    ? skillPageHref(base, slugs[0])
                    : slugs.length
                      ? `${listHref}?fresh=${slugs.map(encodeURIComponent).join(",")}`
                      : listHref,
            )
        },
        [base, listHref],
    )
    const flow = useSkillCreateFlow({projectId, onCreated: showAdded})
    const {leave, modal, discardThen} = useSkillLeaveGuard(
        flow.dirty && !flow.busy,
        t("skills.page.discardNewBody"),
    )
    leaveRef.current = leave

    // `?start=` opens on one way in, once the router has the query.
    const {write, setStep, upload} = flow
    const started = useRef(false)
    useEffect(() => {
        if (started.current || !router.isReady) return
        started.current = true
        const start = router.query.start
        if (start === "write") write()
        else if (start === "import") setStep("import")
        else if (start === "upload" && pendingUpload) {
            upload(pendingUpload.scan)
            setPendingUpload(null)
        } else if (start === "upload") {
            // The picked files do not survive a reload: drop the stale `start`.
            const query = {...router.query}
            delete query.start
            void router.replace({pathname: router.pathname, query}, undefined, {shallow: true})
        }
    }, [pendingUpload, router, setPendingUpload, setStep, upload, write])

    // The page header's slot for the editor's Files toggle (wide windows).
    const [filesSlot, setFilesSlot] = useState<HTMLDivElement | null>(null)

    const back =
        flow.step === "choose"
            ? {label: t("skills.page.skills"), href: listHref}
            : {label: t("skills.page.newSkill"), onBack: () => discardThen(flow.reset)}

    const stepHeading = (title: string, hint: string) => (
        <div className="flex flex-col gap-1">
            <h2 className="m-0 text-subtitle text-foreground">{title}</h2>
            <p className="m-0 text-body text-muted-foreground">{hint}</p>
        </div>
    )
    const errorAlert = flow.error ? <Alert type="error" showIcon message={flow.error} /> : null

    let body: React.ReactNode
    if (flow.step === "write") {
        body = (
            <SkillEditor
                draft={flow.draft}
                onChange={flow.setDraft}
                showMissing={flow.attempted}
                filesToggleSlot={filesSlot}
                notices={
                    <>
                        {flow.duplicate?.workflow_slug ? (
                            <Alert
                                type="warning"
                                showIcon
                                message={t("skills.page.duplicateNew", {
                                    name: flow.duplicate.skill_name ?? flow.duplicate.name ?? "",
                                })}
                                action={
                                    <Button size="sm" variant="outline" asChild>
                                        <Link
                                            href={skillPageHref(base, flow.duplicate.workflow_slug)}
                                        >
                                            {t("skills.page.openIt")}
                                        </Link>
                                    </Button>
                                }
                            />
                        ) : null}
                        {errorAlert}
                    </>
                }
            />
        )
    } else if (flow.step === "import") {
        body = <SkillGithubImport projectId={projectId} onImported={showAdded} />
    } else if (flow.step === "upload") {
        // The same Select all and footer as the GitHub step.
        const keys = flow.uploadCandidates.map((c) => c.key)
        const allPicked = keys.length > 0 && flow.picked.size === keys.length
        body = (
            <div className="flex flex-col gap-6">
                {stepHeading(t("skills.page.uploadTitle"), t("skills.page.uploadHint"))}
                <div className="flex flex-col gap-3">
                    {keys.length > 1 ? (
                        <div className="flex min-h-8 items-center justify-end">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={flow.busy}
                                onClick={() => flow.setPicked(new Set(allPicked ? [] : keys))}
                            >
                                {allPicked
                                    ? t("skills.editor.clearAll")
                                    : t("skills.editor.selectAll")}
                            </Button>
                        </div>
                    ) : null}
                    <SkillCandidateList
                        candidates={flow.uploadCandidates}
                        selected={flow.picked}
                        onToggle={flow.togglePick}
                        disabled={flow.busy}
                    />
                    {errorAlert}
                    <div className="sticky bottom-0 z-sticky mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-0 border-t border-solid border-border-muted bg-background py-3">
                        <span className="grow basis-60 text-meta text-muted-foreground">
                            {t("skills.editor.trustNote")}
                        </span>
                        <LoadingButton
                            type="button"
                            onClick={() => void flow.importUploads()}
                            loading={flow.busy}
                            disabled={!flow.picked.size}
                        >
                            {flow.picked.size
                                ? t("skills.page.addSkills", {count: flow.picked.size})
                                : t("skills.page.chooseToAdd")}
                        </LoadingButton>
                    </div>
                </div>
            </div>
        )
    } else {
        body = (
            <div className="flex flex-col gap-4">
                <SkillCreateWays
                    onWrite={() => write()}
                    onUpload={upload}
                    onImport={() => setStep("import")}
                    busy={flow.busy}
                />
                {errorAlert}
            </div>
        )
    }

    return (
        <>
            <PageLayout
                workspaceId={workspaceId}
                projectId={projectId}
                width="sm"
                back={back}
                // The GitHub step is its own page in the design: its Mark, title and hint on top.
                title={
                    flow.step === "import" ? (
                        <span className="flex min-w-0 items-center gap-3">
                            <IconTile
                                size={32}
                                className="shrink-0 bg-foreground/10 text-foreground"
                            >
                                <GithubLogo />
                            </IconTile>
                            <h1 className="m-0 min-w-0 truncate text-heading text-foreground">
                                {t("skills.page.importTitle")}
                            </h1>
                        </span>
                    ) : flow.step === "write" ? (
                        // The name is the page title, edited in place, as on the skill page.
                        <SkillNameTitle
                            value={flow.draft.name}
                            onChange={(name) => flow.setDraft({...flow.draft, name})}
                            disabled={flow.busy}
                            invalid={flow.attempted && !flow.draft.name.trim()}
                            error={t("skills.editor.nameMissing")}
                            autoFocus={!flow.draft.name}
                        />
                    ) : (
                        t("skills.page.newSkill")
                    )
                }
                documentTitle={
                    flow.step === "import"
                        ? t("skills.page.importTitle")
                        : t("skills.page.newSkill")
                }
                description={
                    flow.step === "import"
                        ? t("skills.page.importHint")
                        : flow.step === "write"
                          ? undefined
                          : t("skills.page.createDescriptionManual")
                }
                actions={
                    flow.step === "write" ? (
                        <>
                            <Button
                                variant="outline"
                                disabled={flow.busy}
                                onClick={() => void router.push(listHref)}
                            >
                                {t("skills.page.cancel")}
                            </Button>
                            <LoadingButton onClick={() => void flow.create()} loading={flow.busy}>
                                {t("skills.page.createSkill")}
                            </LoadingButton>
                            <div ref={setFilesSlot} className="flex empty:hidden" />
                        </>
                    ) : undefined
                }
            >
                {/* Each step swaps in with the kit view transition (MOTION-01); inert while a create runs. */}
                <div
                    key={flow.step}
                    className="ag-view-enter"
                    inert={flow.step === "write" && flow.busy}
                >
                    {body}
                </div>
            </PageLayout>
            {modal}
        </>
    )
}
