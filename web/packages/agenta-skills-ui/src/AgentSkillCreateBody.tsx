/** The agent's "New skill" view: choose how, then write, upload or import; each skill joins the agent. */
import {useCallback, useEffect, useRef, useState} from "react"

import {useT} from "@agenta/i18n"
import skillsAgentCatalog from "@agenta/i18n/catalogs/skills.agent"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import skillsPageCatalog from "@agenta/i18n/catalogs/skills.page"
import {projectIdAtom} from "@agenta/shared/state"
import {buildSkillEmbedEntry} from "@agenta/skills"
import type {NewSkillBodyProps} from "@agenta/ui/drill-in"
import {Alert, Button, Spinner} from "@agenta/ui/ui"
import {useViewForm, useViewTitle, ViewFooterStart} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {SkillCandidateList} from "./SkillCandidateList"
import {SkillCreateWays} from "./SkillCreateWays"
import {SkillDiscardDialog} from "./SkillDiscardDialog"
import {SkillEditor} from "./SkillEditor"
import {SkillGithubImport, type ImportedSkill} from "./SkillGithubImport"
import {useSkillCreateFlow, type CreatedSkill} from "./useSkillCreateFlow"

type Made = CreatedSkill | ImportedSkill

/** The `@ag.embed` entry of each new skill; a skill with no slug cannot be added. */
const toEntries = (skills: Made[]): Record<string, unknown>[] =>
    skills.flatMap((skill) =>
        skill.workflowSlug
            ? [
                  buildSkillEmbedEntry({
                      slug: skill.workflowSlug,
                      workflowId: skill.workflowId,
                      name: skill.name ?? skill.workflowSlug,
                      description: skill.description,
                      mode: "latest",
                  }) as unknown as Record<string, unknown>,
              ]
            : [],
    )

export function AgentSkillCreateBody({onCreated, onDone}: NewSkillBodyProps) {
    const t = useT(skillsAgentCatalog, skillsPageCatalog, skillsEditorCatalog)
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const onCreatedRef = useRef(onCreated)
    onCreatedRef.current = onCreated
    // Set by the flow when a write lands, so Save knows the view may leave.
    const made = useRef(false)
    const add = useCallback((skills: Made[]) => {
        made.current = skills.length > 0
        const entries = toEntries(skills)
        if (entries.length) onCreatedRef.current(entries)
    }, [])
    const flow = useSkillCreateFlow({projectId, onCreated: add})
    const [asking, setAsking] = useState<(() => void) | null>(null)

    const {step, reset, write, upload, setStep} = flow
    const writing = step === "write"
    /** Runs `go`, after the discard question when a written draft would be lost. */
    const guard = useCallback(
        (go: () => void) => (writing && flow.dirty ? setAsking(() => go) : go()),
        [flow.dirty, writing],
    )
    const leave = useCallback(() => onDone?.(), [onDone])

    const titles = {
        choose: t("skills.agent.newSkill"),
        write: t("skills.agent.writeTitle"),
        upload: t("skills.agent.uploadTitle"),
        import: t("skills.agent.importTitle"),
    }
    useViewTitle(titles[step])

    const save = useCallback(async () => {
        made.current = false
        if (step === "write") await flow.create()
        else if (step === "upload") await flow.importUploads()
        return made.current ? true : ("stay" as const)
    }, [flow, step])

    useViewForm({
        dirty: flow.dirty,
        valid: step === "upload" ? flow.picked.size > 0 : true,
        save,
        saveLabel:
            step === "upload"
                ? t("skills.agent.addSkills", {count: flow.picked.size})
                : t("skills.agent.createAndAdd"),
        savingLabel: t("skills.agent.creating"),
        leaveTitle: t("skills.page.discardTitle"),
        leaveDescription: t("skills.page.discardNewBody"),
        leaveCanSave: false,
        ...(step === "upload" ? {saveWhenClean: true as const} : {}),
        // The choice and the GitHub import carry their own controls.
        ...(step === "choose" || step === "import" ? {actionRow: false as const} : {}),
        ...(step === "choose" ? {} : {back: () => guard(reset), backTitle: titles.choose}),
        ...(writing ? {cancel: () => guard(leave)} : {}),
    })

    // A click opened the view: move focus into it, so Escape and Tab start here.
    const rootRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const root = rootRef.current
        if (root && !root.contains(document.activeElement)) root.focus({preventScroll: true})
    }, [])

    const errorAlert = flow.error ? <Alert type="error" showIcon message={flow.error} /> : null

    let body: React.ReactNode
    if (step === "write") {
        body = (
            <>
                <SkillEditor
                    draft={flow.draft}
                    onChange={flow.setDraft}
                    showName
                    autoFocusName={!flow.draft.name}
                    showMissing={flow.attempted}
                    filesPlacement="inline"
                    notices={
                        <>
                            {flow.duplicate ? (
                                <Alert
                                    type="warning"
                                    showIcon
                                    message={t("skills.page.duplicateNew", {
                                        name:
                                            flow.duplicate.skill_name ?? flow.duplicate.name ?? "",
                                    })}
                                />
                            ) : null}
                            {errorAlert}
                        </>
                    }
                />
                <ViewFooterStart ownLineOnPhone>
                    <span className="text-meta text-muted-foreground">
                        {t("skills.agent.savedAndAdded")}
                    </span>
                </ViewFooterStart>
            </>
        )
    } else if (step === "upload") {
        // The same Select all as the Skills page upload and the GitHub step.
        const keys = flow.uploadCandidates.map((c) => c.key)
        const allPicked = keys.length > 0 && flow.picked.size === keys.length
        body = (
            <div className="flex flex-col gap-4">
                <p className="m-0 text-body text-muted-foreground">{t("skills.page.uploadHint")}</p>
                {keys.length > 1 ? (
                    <div className="flex min-h-8 items-center justify-end">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={flow.busy}
                            onClick={() => flow.setPicked(new Set(allPicked ? [] : keys))}
                        >
                            {allPicked ? t("skills.editor.clearAll") : t("skills.editor.selectAll")}
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
            </div>
        )
    } else if (step === "import") {
        body = (
            <div className="flex flex-col gap-4">
                <p className="m-0 text-body text-muted-foreground">{t("skills.page.importHint")}</p>
                <SkillGithubImport
                    projectId={projectId}
                    onImported={(skills) => {
                        add(skills)
                        leave()
                    }}
                />
            </div>
        )
    } else {
        body = (
            <div className="flex flex-col gap-4">
                <p className="m-0 text-body text-muted-foreground">
                    {t("skills.agent.chooseDescription")}
                </p>
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
        <div
            ref={rootRef}
            tabIndex={-1}
            className="flex min-h-0 flex-1 flex-col px-4 py-4 outline-none"
        >
            {body}
            <SkillDiscardDialog
                open={asking !== null}
                onKeep={() => setAsking(null)}
                onDiscard={() => {
                    const go = asking
                    setAsking(null)
                    go?.()
                }}
            />
        </div>
    )
}

export default AgentSkillCreateBody
