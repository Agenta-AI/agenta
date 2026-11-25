import {useCallback, useMemo, useRef, useState} from "react"

import type {SkillUploadScan} from "@agenta/entity-ui/drill-in"
import {createT} from "@agenta/i18n"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {createSkillWorkflow, skillContentSchema} from "@agenta/skills"
import {invalidateSkillsListCache, skillsResolveDataAtom} from "@agenta/skills/state"
import {useAtomValue} from "jotai"

import type {SkillCandidate} from "./SkillCandidateList"
import {
    descriptionTooLong,
    draftSkillName,
    EMPTY_SKILL_DRAFT,
    isSkillDraftEmpty,
    toSkillContent,
    toSkillDraft,
    type SkillDraft,
} from "./skillDraft"

export type SkillCreateStep = "choose" | "write" | "upload" | "import"

export interface CreatedSkill {
    workflowSlug: string
    name: string
    workflowId?: string
    description?: string
}

const tNow = createT(skillsEditorCatalog)

const failure = (err: unknown, fallback: string) => extractApiErrorMessage(err) || fallback

/** The create page's state: the step, the draft, an upload's picks, and the writes. */
export function useSkillCreateFlow({
    projectId,
    onCreated,
}: {
    projectId: string
    onCreated: (created: CreatedSkill[]) => void
}) {
    const [step, showStep] = useState<SkillCreateStep>("choose")
    const [draft, setDraft] = useState<SkillDraft>(EMPTY_SKILL_DRAFT)
    const [attempted, setAttempted] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [scan, setScan] = useState<SkillUploadScan | null>(null)
    const [picked, setPicked] = useState<Set<string>>(new Set())
    const registry = useAtomValue(skillsResolveDataAtom)
    // Bumped on every step change, so a scan that ends after the user moved on is ignored.
    const run = useRef(0)
    // Upload picks already created by an earlier, partly failed import.
    const createdSoFar = useRef<CreatedSkill[]>([])

    const setStep = useCallback((next: SkillCreateStep) => {
        run.current += 1
        setBusy(false)
        showStep(next)
    }, [])

    const reset = useCallback(() => {
        run.current += 1
        createdSoFar.current = []
        showStep("choose")
        setDraft(EMPTY_SKILL_DRAFT)
        setAttempted(false)
        setBusy(false)
        setError(null)
        setScan(null)
        setPicked(new Set())
    }, [])

    const write = useCallback((next: SkillDraft = EMPTY_SKILL_DRAFT) => {
        run.current += 1
        setDraft(next)
        setAttempted(false)
        setBusy(false)
        setError(null)
        showStep("write")
    }, [])

    const upload = useCallback(
        (pending: Promise<SkillUploadScan>) => {
            const id = ++run.current
            setError(null)
            setBusy(true)
            pending
                .then((result) => {
                    if (id !== run.current) return
                    const [first] = result.candidates
                    if (!first) {
                        setError(tNow("skills.editor.noSkillMd"))
                        return
                    }
                    if (result.candidates.length === 1) {
                        write(toSkillDraft(first.skill as unknown as Record<string, unknown>))
                        return
                    }
                    createdSoFar.current = []
                    setScan(result)
                    // None picked, as on the GitHub step.
                    setPicked(new Set())
                    showStep("upload")
                })
                .catch(() => id === run.current && setError(tNow("skills.editor.readUploadFailed")))
                .finally(() => id === run.current && setBusy(false))
        },
        [write],
    )

    const createOne = useCallback(
        async (skill: Record<string, unknown>): Promise<CreatedSkill> => {
            const result = skillContentSchema.safeParse(skill)
            if (!result.success) {
                const field = result.error.issues[0]?.path.join(".") || "content"
                throw new Error(tNow("skills.editor.fieldInvalid", {field}))
            }
            const created = await createSkillWorkflow({projectId, skill: result.data})
            return {
                workflowSlug: created.slug,
                name: result.data.name,
                workflowId: created.workflowId,
                description: result.data.description,
            }
        },
        [projectId],
    )

    const create = useCallback(async () => {
        setAttempted(true)
        if (
            !draftSkillName(draft) ||
            !draft.description.trim() ||
            descriptionTooLong(draft) ||
            !draft.body.trim()
        )
            return
        setBusy(true)
        setError(null)
        try {
            const created = await createOne(toSkillContent(draft))
            invalidateSkillsListCache()
            onCreated([created])
        } catch (err) {
            setError(failure(err, tNow("skills.editor.createFailed")))
        } finally {
            setBusy(false)
        }
    }, [createOne, draft, onCreated])

    const importUploads = useCallback(async () => {
        if (!scan) return
        setBusy(true)
        setError(null)
        const done = new Set<string>()
        try {
            for (const candidate of scan.candidates.filter((c) => picked.has(c.dir))) {
                const skill = candidate.skill as unknown as Record<string, unknown>
                createdSoFar.current.push(await createOne(toSkillContent(toSkillDraft(skill))))
                done.add(candidate.dir)
            }
            const created = createdSoFar.current
            createdSoFar.current = []
            onCreated(created)
        } catch (err) {
            // Stay on the step: the created ones leave the list, the failed ones stay picked.
            setError(failure(err, tNow("skills.editor.importFailed")))
            if (done.size) {
                setScan({...scan, candidates: scan.candidates.filter((c) => !done.has(c.dir))})
                setPicked((current) => new Set([...current].filter((key) => !done.has(key))))
            }
        } finally {
            if (done.size) invalidateSkillsListCache()
            setBusy(false)
        }
    }, [createOne, onCreated, picked, scan])

    const togglePick = useCallback(
        (key: string) =>
            setPicked((current) => {
                const next = new Set(current)
                if (!next.delete(key)) next.add(key)
                return next
            }),
        [],
    )

    const uploadCandidates = useMemo<SkillCandidate[]>(
        () =>
            (scan?.candidates ?? []).map((c) => ({
                key: c.dir,
                title: c.skill.name || c.dir,
                description: c.skill.description,
                runsPrograms: c.skill.files?.some((file) => file.executable),
            })),
        [scan],
    )

    const name = draftSkillName(draft)
    const duplicate = useMemo(
        () =>
            name
                ? registry.find((item) => (item.skill_name ?? item.name) === name && !item.archived)
                : undefined,
        [name, registry],
    )

    return {
        step,
        setStep,
        draft,
        setDraft,
        attempted,
        busy,
        error,
        reset,
        write,
        upload,
        create,
        importUploads,
        uploadCandidates,
        picked,
        setPicked,
        togglePick,
        duplicate,
        dirty: step === "write" && !isSkillDraftEmpty(draft),
    }
}

export type SkillCreateFlow = ReturnType<typeof useSkillCreateFlow>
