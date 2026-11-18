import {useCallback, useMemo, useState} from "react"

import type {SkillUploadScan} from "@agenta/entity-ui/drill-in"
import {createSkillWorkflow, skillContentSchema} from "@agenta/skills"
import {invalidateSkillsListCache, skillsListDataAtom} from "@agenta/skills/state"
import {useAtomValue} from "jotai"

import type {SkillCandidate} from "./SkillCandidateList"
import {
    descriptionTooLong,
    draftSkillName,
    EMPTY_SKILL_DRAFT,
    skillDraftProblem,
    toSkillContent,
    toSkillDraft,
    type SkillDraft,
} from "./skillDraft"

export type SkillCreateStep = "choose" | "write" | "upload" | "github"

export interface CreatedSkill {
    workflowId?: string
    slug: string
    name: string
    description?: string
}

const failure = (err: unknown, what: string) =>
    err instanceof Error && err.message ? `${what} failed: ${err.message}` : `${what} failed.`

/** The create flow's state: which step, the draft, an upload's picks, and the writes. */
export function useSkillCreateFlow({
    projectId,
    onCreated,
}: {
    projectId: string
    onCreated: (created: CreatedSkill[]) => void
}) {
    const [step, setStep] = useState<SkillCreateStep>("choose")
    const [draft, setDraft] = useState<SkillDraft>(EMPTY_SKILL_DRAFT)
    const [fromUpload, setFromUpload] = useState(false)
    const [attempted, setAttempted] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [scan, setScan] = useState<SkillUploadScan | null>(null)
    const [picked, setPicked] = useState<Set<string>>(new Set())
    const registry = useAtomValue(skillsListDataAtom)

    const reset = useCallback(() => {
        setStep("choose")
        setDraft(EMPTY_SKILL_DRAFT)
        setFromUpload(false)
        setAttempted(false)
        setBusy(false)
        setError(null)
        setScan(null)
        setPicked(new Set())
    }, [])

    const write = useCallback((title = "") => {
        setDraft({...EMPTY_SKILL_DRAFT, title})
        setFromUpload(false)
        setAttempted(false)
        setError(null)
        setStep("write")
    }, [])

    const upload = useCallback((pending: Promise<SkillUploadScan>) => {
        setError(null)
        setBusy(true)
        pending
            .then((result) => {
                const [first] = result.candidates
                if (!first) {
                    setError("No SKILL.md found in the upload.")
                    return
                }
                if (result.candidates.length === 1) {
                    setDraft(toSkillDraft(first.skill as unknown as Record<string, unknown>))
                    setFromUpload(true)
                    setAttempted(false)
                    setStep("write")
                    return
                }
                setScan(result)
                setPicked(new Set(result.candidates.map((c) => c.dir)))
                setStep("upload")
            })
            .catch(() => setError("Could not read the upload."))
            .finally(() => setBusy(false))
    }, [])

    const createOne = useCallback(
        async (skill: Record<string, unknown>): Promise<CreatedSkill> => {
            const parsed = skillContentSchema.parse(skill)
            const created = await createSkillWorkflow({projectId, skill: parsed})
            return {
                workflowId: created.workflowId,
                slug: created.slug,
                name: parsed.name,
                description: parsed.description,
            }
        },
        [projectId],
    )

    const create = useCallback(async () => {
        setAttempted(true)
        if (skillDraftProblem(draft)) return
        setBusy(true)
        setError(null)
        try {
            const created = await createOne(toSkillContent(draft))
            invalidateSkillsListCache()
            onCreated([created])
        } catch (err) {
            setError(failure(err, "Create"))
        } finally {
            setBusy(false)
        }
    }, [createOne, draft, onCreated])

    const importUploads = useCallback(async () => {
        if (!scan) return
        setBusy(true)
        setError(null)
        const created: CreatedSkill[] = []
        try {
            for (const candidate of scan.candidates.filter((c) => picked.has(c.dir))) {
                const skill = candidate.skill as unknown as Record<string, unknown>
                created.push(await createOne(toSkillContent(toSkillDraft(skill))))
            }
            onCreated(created)
        } catch (err) {
            setError(failure(err, "Import"))
        } finally {
            if (created.length) invalidateSkillsListCache()
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
                title: toSkillDraft(c.skill as unknown as Record<string, unknown>).title || c.dir,
                description: c.skill.description,
            })),
        [scan],
    )

    const duplicate = useMemo(() => {
        const name = draftSkillName(draft)
        if (!name) return undefined
        return registry.find((item) => (item.skill_name ?? item.name) === name && !item.archived)
    }, [draft, registry])

    return {
        step,
        setStep,
        draft,
        setDraft,
        fromUpload,
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
        togglePick,
        duplicate,
        canCreate: Boolean(draft.title.trim()) && !descriptionTooLong(draft) && !busy,
    }
}

export type SkillCreateFlow = ReturnType<typeof useSkillCreateFlow>
