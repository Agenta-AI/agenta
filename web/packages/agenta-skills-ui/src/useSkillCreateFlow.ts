import {useCallback, useMemo, useRef, useState} from "react"

import type {SkillScanCandidate, SkillUploadScan} from "@agenta/entity-ui/drill-in"
import {createT} from "@agenta/i18n"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {createSkillWorkflow, skillContentSchema} from "@agenta/skills"
import {invalidateSkillsListCache, skillsResolveDataAtom} from "@agenta/skills/state"
import {message} from "@agenta/ui/app-message"
import {useAtomValue} from "jotai"

import type {SkillCandidate} from "./SkillCandidateList"
import {
    descriptionTooLong,
    draftSkillName,
    EMPTY_SKILL_DRAFT,
    isSkillDraftEmpty,
    SKILL_NAME_INPUT,
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

/** An upload candidate with its own key: two SKILL.md files can share a folder. */
type KeyedCandidate = SkillScanCandidate & {key: string}

/** FORM-03: after a failed create, the focus goes to the name when the name is the problem. */
const focusName = () =>
    requestAnimationFrame(() =>
        // The shown one: a view under this one in a stack can hold another name input.
        [...document.querySelectorAll<HTMLInputElement>(`[${SKILL_NAME_INPUT}]`)]
            .filter((input) => input.offsetParent !== null)
            .pop()
            ?.focus(),
    )

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
    // Set once a create succeeds: the page stays locked until it navigates away.
    const [done, setDone] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [candidates, setCandidates] = useState<KeyedCandidate[]>([])
    const [picked, setPicked] = useState<Set<string>>(new Set())
    const registry = useAtomValue(skillsResolveDataAtom)
    // Bumped on every step change, so a scan that ends after the user moved on is ignored.
    const run = useRef(0)
    // Upload picks already created by an earlier, partly failed import.
    const createdSoFar = useRef<CreatedSkill[]>([])

    const setStep = useCallback((next: SkillCreateStep) => {
        run.current += 1
        setBusy(false)
        setDone(false)
        showStep(next)
    }, [])

    const reset = useCallback(() => {
        run.current += 1
        createdSoFar.current = []
        showStep("choose")
        setDraft(EMPTY_SKILL_DRAFT)
        setAttempted(false)
        setBusy(false)
        setDone(false)
        setError(null)
        setCandidates([])
        setPicked(new Set())
    }, [])

    const write = useCallback((next: SkillDraft = EMPTY_SKILL_DRAFT) => {
        run.current += 1
        setDraft(next)
        setAttempted(false)
        setBusy(false)
        setDone(false)
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
                    setCandidates(
                        result.candidates.map((c, index) => ({...c, key: `${index}:${c.dir}`})),
                    )
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
        if (!draftSkillName(draft)) {
            focusName()
            return
        }
        if (!draft.description.trim() || descriptionTooLong(draft) || !draft.body.trim()) return
        setBusy(true)
        setError(null)
        try {
            const created = await createOne(toSkillContent(draft))
            // Stays busy: editing is locked while the page navigates away.
            setDone(true)
            onCreated([created])
            message.success(tNow("skills.editor.created"))
            invalidateSkillsListCache()
        } catch (err) {
            setError(failure(err, tNow("skills.editor.createFailed")))
            setBusy(false)
        }
    }, [createOne, draft, onCreated])

    const importUploads = useCallback(async () => {
        if (!candidates.length) return
        setBusy(true)
        setError(null)
        const added = new Set<string>()
        try {
            for (const candidate of candidates.filter((c) => picked.has(c.key))) {
                const skill = candidate.skill as unknown as Record<string, unknown>
                createdSoFar.current.push(await createOne(toSkillContent(toSkillDraft(skill))))
                added.add(candidate.key)
            }
            const created = createdSoFar.current
            createdSoFar.current = []
            setDone(true)
            onCreated(created)
            message.success(tNow("skills.editor.imported", {count: created.length}))
        } catch (err) {
            // Stay on the step: the created ones leave the list, the failed ones stay picked.
            setError(failure(err, tNow("skills.editor.importFailed")))
            if (added.size) {
                setCandidates(candidates.filter((c) => !added.has(c.key)))
                setPicked((current) => new Set([...current].filter((key) => !added.has(key))))
            }
        } finally {
            if (added.size) invalidateSkillsListCache()
            setBusy(false)
        }
    }, [candidates, createOne, onCreated, picked])

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
            candidates.map((c) => ({
                key: c.key,
                title: c.skill.name || c.dir,
                description: c.skill.description,
                runsPrograms: c.skill.files?.some((file) => file.executable),
            })),
        [candidates],
    )

    const name = draftSkillName(draft)
    // Not after a create: the list then holds the skill just made.
    const duplicate = useMemo(
        () =>
            name && !done
                ? registry.find((item) => (item.skill_name ?? item.name) === name && !item.archived)
                : undefined,
        [done, name, registry],
    )

    return {
        step,
        setStep,
        draft,
        setDraft,
        attempted,
        busy: busy || done,
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
