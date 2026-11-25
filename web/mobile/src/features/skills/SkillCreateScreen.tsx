import {useCallback, useEffect, useRef} from "react"

import {useT} from "@agenta/i18n"
import skillsPageCatalog from "@agenta/i18n/catalogs/skills.page"
import {
    SkillCandidateList,
    SkillCreateWays,
    SkillEditor,
    SkillGithubImport,
    useSkillCreateFlow,
    type CreatedSkill,
    type ImportedSkill,
} from "@agenta/skills-ui"
import {Alert, Button, IconTile, Spinner} from "@agenta/ui/ui"
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
    const t = useT(skillsPageCatalog)
    const router = useRouter()
    const base = `/w/${workspaceId}/p/${projectId}`
    const listHref = skillsListHref(base)
    const [pendingUpload, setPendingUpload] = useAtom(pendingSkillUploadAtom)

    // One new skill opens its page; several go back to the list, marked fresh.
    const leaveRef = useRef<(url: string) => void>(() => undefined)
    const showAdded = useCallback(
        (skills: (CreatedSkill | ImportedSkill)[]) => {
            const slugs = skills.flatMap((skill) => (skill.workflowSlug ? [skill.workflowSlug] : []))
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
            upload(pendingUpload)
            setPendingUpload(null)
        }
    }, [pendingUpload, router.isReady, router.query.start, setPendingUpload, setStep, upload, write])

    const back =
        flow.step === "choose"
            ? {label: t("skills.page.skills"), href: listHref}
            : {label: t("skills.page.newSkill"), onBack: () => discardThen(flow.reset)}

    const stepHeading = (title: string, hint: string) => (
        <div className="flex flex-col gap-1">
            <h2 className="m-0 text-title text-foreground">{title}</h2>
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
                showName
                autoFocusName={!flow.draft.name}
                showMissing={flow.attempted}
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
        body = (
            <SkillGithubImport projectId={projectId} onImported={showAdded} />
        )
    } else if (flow.step === "upload") {
        body = (
            <div className="flex flex-col gap-6">
                {stepHeading(t("skills.page.uploadTitle"), t("skills.page.uploadHint"))}
                <SkillCandidateList
                    candidates={flow.uploadCandidates}
                    selected={flow.picked}
                    onToggle={flow.togglePick}
                    disabled={flow.busy}
                />
                {errorAlert}
                <Button
                    className="self-end"
                    onClick={() => void flow.importUploads()}
                    disabled={!flow.picked.size || flow.busy}
                >
                    {flow.busy ? <Spinner size="small" /> : null}
                    {t("skills.page.importSkills", {count: flow.picked.size})}
                </Button>
            </div>
        )
    } else {
        body = (
            <div className="flex flex-col gap-4">
                <SkillCreateWays
                    onWrite={() => write()}
                    onUpload={upload}
                    onImport={() => setStep("import")}
                />
                {flow.busy ? <Spinner size="small" className="self-center" /> : null}
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
                        <span className="flex items-center gap-3">
                            <IconTile size={32} className="bg-foreground text-background">
                                <GithubLogo />
                            </IconTile>
                            {t("skills.page.importTitle")}
                        </span>
                    ) : (
                        t("skills.page.newSkill")
                    )
                }
                documentTitle={
                    flow.step === "import" ? t("skills.page.importTitle") : t("skills.page.newSkill")
                }
                description={
                    flow.step === "import"
                        ? t("skills.page.importHint")
                        : t("skills.page.createDescription")
                }
                actions={
                    flow.step === "write" ? (
                        <>
                            <Button variant="outline" onClick={() => void router.push(listHref)}>
                                {t("skills.page.cancel")}
                            </Button>
                            <Button onClick={() => void flow.create()} disabled={flow.busy}>
                                {flow.busy ? <Spinner size="small" /> : null}
                                {t("skills.page.createSkill")}
                            </Button>
                        </>
                    ) : undefined
                }
            >
                {body}
            </PageLayout>
            {modal}
        </>
    )
}
