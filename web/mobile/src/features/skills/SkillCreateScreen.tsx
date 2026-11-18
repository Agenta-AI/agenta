import {useCallback, useEffect, useRef} from "react"

import {
    SkillCandidateList,
    SkillCreateChooser,
    SkillEditor,
    SkillGithubImport,
    useSkillCreateFlow,
    type CreatedSkill,
    type ImportedSkill,
} from "@agenta/skills-ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {Button, Spinner} from "@agenta/ui/ui"
import {WarningCircle} from "@phosphor-icons/react"
import {useAtom} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {pendingSkillUploadAtom} from "./pendingUpload"
import {SkillBackLink} from "./SkillBackLink"
import {useSkillLeaveGuard} from "./useSkillLeaveGuard"

const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

/** New skill: one page with every way in, then the editor or the GitHub import. */
export const SkillCreateScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const router = useRouter()
    const listHref = `/w/${workspaceId}/p/${projectId}/skills`
    const [pendingUpload, setPendingUpload] = useAtom(pendingSkillUploadAtom)

    const leaveRef = useRef<(url: string) => void>(() => undefined)
    const onCreated = useCallback(
        (created: CreatedSkill[]) => {
            const ids = created.map((skill) => skill.workflowId).filter(Boolean)
            leaveRef.current(
                ids.length === 1 ? `${listHref}/${ids[0]}` : `${listHref}?added=${ids.join(",")}`,
            )
        },
        [listHref],
    )
    const flow = useSkillCreateFlow({projectId, onCreated})
    const dirty =
        flow.step === "write" &&
        Boolean(flow.draft.title || flow.draft.description || flow.draft.body)
    const {leave, modal} = useSkillLeaveGuard(dirty && !flow.busy)
    leaveRef.current = leave

    const start = typeof router.query.start === "string" ? router.query.start : ""
    const {write, setStep, upload} = flow
    useEffect(() => {
        if (start === "write") write()
        else if (start === "github") setStep("github")
        else if (start === "upload" && pendingUpload) {
            upload(pendingUpload)
            setPendingUpload(null)
        }
    }, [pendingUpload, setPendingUpload, setStep, start, upload, write])

    const onImported = (imported: ImportedSkill[]) =>
        onCreated(
            imported.map((skill) => ({
                workflowId: skill.workflowId,
                slug: "",
                name: skill.name ?? "",
            })),
        )

    const back =
        flow.step === "choose" ? (
            <SkillBackLink href={listHref} label="Skills" />
        ) : (
            <SkillBackLink
                href={`${listHref}/new`}
                label="Add a skill"
                onClick={(event) => {
                    event.preventDefault()
                    flow.setStep("choose")
                }}
            />
        )

    const centered = (children: React.ReactNode) => (
        <div className="mx-auto my-auto flex w-full max-w-[640px] flex-col gap-6 pb-12 pt-6 sm:pt-16">
            {children}
        </div>
    )

    let body: React.ReactNode
    if (flow.step === "write") {
        body = (
            <SkillEditor
                draft={flow.draft}
                onChange={flow.setDraft}
                fill
                autoFocusTitle={!flow.fromUpload}
                showMissing={flow.attempted}
                actions={
                    <>
                        <Button variant="outline" onClick={() => void router.push(listHref)}>
                            Cancel
                        </Button>
                        <Button onClick={() => void flow.create()} disabled={!flow.canCreate}>
                            {flow.busy ? <Spinner size="small" /> : null}
                            Create skill
                        </Button>
                    </>
                }
                notices={
                    <>
                        {flow.duplicate ? (
                            <div
                                role="alert"
                                className="flex items-center gap-2 rounded-[10px] bg-tag-orange-bg px-3 py-2 text-sm text-tag-orange"
                            >
                                <WarningCircle size={16} className="shrink-0" />
                                <span className="flex-1">
                                    You already have a skill called “{flow.draft.title}”. Creating
                                    this one makes a second copy.
                                </span>
                                <Link
                                    href={`${listHref}/${flow.duplicate.workflow_id}`}
                                    className="font-medium text-tag-orange"
                                >
                                    Open it
                                </Link>
                            </div>
                        ) : null}
                        {flow.error ? (
                            <p role="alert" className="m-0 text-sm text-destructive">
                                {flow.error}
                            </p>
                        ) : null}
                    </>
                }
            />
        )
    } else if (flow.step === "github") {
        body = centered(<SkillGithubImport projectId={projectId} onImported={onImported} />)
    } else if (flow.step === "upload") {
        body = centered(
            <>
                <div className="flex flex-col gap-1 text-center">
                    <h1 className="m-0 text-2xl font-semibold">Review the upload</h1>
                    <p className="m-0 text-sm text-muted-foreground">
                        Pick the skills to add to this project.
                    </p>
                </div>
                <SkillCandidateList
                    candidates={flow.uploadCandidates}
                    selected={flow.picked}
                    onToggle={flow.togglePick}
                    disabled={flow.busy}
                />
                {flow.error ? <p className="m-0 text-sm text-destructive">{flow.error}</p> : null}
                <Button
                    className="self-end"
                    onClick={() => void flow.importUploads()}
                    disabled={!flow.picked.size || flow.busy}
                >
                    {flow.busy ? <Spinner size="small" /> : null}
                    Add {flow.picked.size} {flow.picked.size === 1 ? "skill" : "skills"}
                </Button>
            </>,
        )
    } else {
        body = centered(
            <>
                <h1 className="m-0 text-center text-2xl font-semibold leading-8">Add a skill</h1>
                <SkillCreateChooser
                    onWrite={() => flow.write()}
                    onUpload={flow.upload}
                    onImport={() => flow.setStep("github")}
                />
                {flow.busy ? <Spinner size="small" className="self-center" /> : null}
                {flow.error ? (
                    <p role="alert" className="m-0 text-center text-sm text-destructive">
                        {flow.error}
                    </p>
                ) : null}
            </>,
        )
    }

    return (
        <>
            <PageTitle title="New skill" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className={`box-border flex shrink-0 items-center gap-2 px-4 pt-3 lg:hidden ${PAGE_FRAME}`}>
                            <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                        </div>
                    }
                >
                    <div
                        className={`flex min-h-full min-w-0 flex-col gap-4 px-4 pb-12 pt-3 lg:pt-8 ${PAGE_FRAME} ${
                            flow.step === "write" ? "flex-1 lg:min-h-0 lg:pb-8" : ""
                        }`}
                    >
                        {back}
                        <div key={flow.step} className="flex flex-1 animate-skill-enter flex-col lg:min-h-0">
                            {body}
                        </div>
                    </div>
                </ScreenScaffold>
            </AppShell>
            {modal}
        </>
    )
}
