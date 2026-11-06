import {useEffect, useMemo, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {VersionBadge} from "@agenta/ui/components/presentational"
import {
    Button,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    LoadingButton,
    Textarea,
} from "@agenta/ui/ui"
import {XIcon} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import type {DraftEvaluator} from "../evaluations/new/newEvaluationDraft"

import type {RunEditValues} from "./useEditEvaluationRun"

// The picker reads the evaluator catalog: it loads only when the dialog opens.
const RunEvaluatorPicker = dynamic(
    () => import("./RunEvaluatorPicker").then((m) => m.RunEvaluatorPicker),
    {ssr: false, loading: () => <span className="block h-8 w-full" aria-hidden />},
)

/** An evaluator the run already has. */
export interface RunEvaluatorEntry {
    revisionId: string | null
    name: string
    version: number | null
}

/**
 * The old app's "Edit evaluation" form: name, description, and the run's evaluators with "Add
 * evaluator". Added evaluators are staged and saved only on Update. Update is off until something
 * changes, and while the name is blank. A failed save keeps the dialog open with the draft.
 */
export const EditEvaluationDialog = ({
    open,
    name,
    description,
    evaluators,
    humanRun,
    onClose,
    onSave,
}: {
    open: boolean
    name: string
    description: string
    evaluators: readonly RunEvaluatorEntry[]
    /** A human run takes human evaluators; any other run takes automatic ones. */
    humanRun: boolean
    onClose: () => void
    onSave: (values: RunEditValues) => Promise<void>
}) => {
    const [draftName, setDraftName] = useState(name)
    const [draftDescription, setDraftDescription] = useState(description)
    const [added, setAdded] = useState<DraftEvaluator[]>([])
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (!open) return
        setDraftName(name)
        setDraftDescription(description)
        setAdded([])
    }, [open, name, description])

    const connectedIds = useMemo(
        () => new Set(evaluators.map((evaluator) => evaluator.revisionId).filter(Boolean)),
        [evaluators],
    )
    // The run's evaluators show as picked in the picker, so they cannot be picked again.
    const picked = useMemo<DraftEvaluator[]>(
        () => [
            ...evaluators.flatMap((evaluator) =>
                evaluator.revisionId
                    ? [
                          {
                              revisionId: evaluator.revisionId,
                              evaluatorId: "",
                              name: evaluator.name,
                              version: evaluator.version ?? 0,
                          },
                      ]
                    : [],
            ),
            ...added,
        ],
        [evaluators, added],
    )

    const pick = (evaluator: DraftEvaluator) => {
        if (connectedIds.has(evaluator.revisionId)) return
        setAdded((current) =>
            current.some((entry) => entry.revisionId === evaluator.revisionId)
                ? current
                : [...current, evaluator],
        )
    }
    const unstage = (revisionId: string) =>
        setAdded((current) => current.filter((entry) => entry.revisionId !== revisionId))

    const dirty = draftName !== name || draftDescription !== description || added.length > 0
    const canSave = dirty && draftName.trim().length > 0 && !saving

    const save = async () => {
        if (!canSave) return
        setSaving(true)
        try {
            await onSave({
                name: draftName.trim(),
                description: draftDescription,
                addedEvaluatorRevisionIds: added.map((entry) => entry.revisionId),
            })
            message.success("Evaluation updated")
            onClose()
        } catch (error) {
            console.error("[EditEvaluationDialog] update failed", error)
            message.error("Failed to update evaluation. Please try again.")
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => (next || saving ? undefined : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Edit evaluation</DialogTitle>
                </DialogHeader>
                <div className="flex min-w-0 flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="edit-evaluation-name">Name</Label>
                        <Input
                            id="edit-evaluation-name"
                            autoFocus
                            placeholder="Evaluation name"
                            value={draftName}
                            onChange={(event) => setDraftName(event.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="edit-evaluation-description">Description</Label>
                        <Textarea
                            id="edit-evaluation-description"
                            placeholder="Add a description"
                            rows={3}
                            value={draftDescription}
                            onChange={(event) => setDraftDescription(event.target.value)}
                        />
                    </div>
                    <section aria-label="Evaluators" className="flex min-w-0 flex-col gap-2">
                        <Label>Evaluators</Label>
                        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                            {evaluators.map((evaluator, index) => (
                                <li
                                    key={evaluator.revisionId ?? `${evaluator.name}-${index}`}
                                    className="flex min-w-0 items-center gap-2 text-sm"
                                >
                                    <span className="truncate">{evaluator.name}</span>
                                    {evaluator.version === null ? null : (
                                        <VersionBadge
                                            version={evaluator.version}
                                            variant="chip"
                                            size="small"
                                        />
                                    )}
                                </li>
                            ))}
                            {added.map((evaluator) => (
                                <li
                                    key={evaluator.revisionId}
                                    className="flex min-w-0 items-center gap-2 text-sm"
                                >
                                    <span className="truncate">{evaluator.name}</span>
                                    <VersionBadge
                                        version={evaluator.version}
                                        variant="chip"
                                        size="small"
                                    />
                                    <Button
                                        type="button"
                                        size="icon-sm"
                                        variant="ghost"
                                        aria-label={`Remove ${evaluator.name}`}
                                        onClick={() => unstage(evaluator.revisionId)}
                                    >
                                        <XIcon aria-hidden size={14} />
                                    </Button>
                                </li>
                            ))}
                        </ul>
                        {open ? (
                            <RunEvaluatorPicker
                                human={humanRun}
                                selected={picked}
                                onPick={pick}
                                onRemove={unstage}
                                onClear={() => setAdded([])}
                            />
                        ) : null}
                    </section>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                    <LoadingButton loading={saving} disabled={!canSave} onClick={save}>
                        Update
                    </LoadingButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
