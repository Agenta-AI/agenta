import {useMemo, useRef, useState, type CSSProperties} from "react"

import type {EvaluatorEntry} from "@agenta/entities/workflow"
import {message} from "@agenta/ui/app-message"
import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from "@agenta/ui/ui"

import {
    draftFromEvaluator,
    emptyHumanEvaluatorDraft,
    type HumanEvaluatorDraft,
} from "./humanEvaluatorForm"
import {HumanEvaluatorForm} from "./HumanEvaluatorForm"
import {useSaveHumanEvaluator, type SaveHumanEvaluatorResult} from "./useSaveHumanEvaluator"

const SHEET_WIDTH = {"--ag-sheet-responsive-width": "560px"} as CSSProperties

/**
 * Create a human evaluator, or edit one (`editing`). A bottom sheet on a phone, a right drawer
 * from `lg` up. Close, Escape and the overlay do nothing while a save runs.
 */
export const HumanEvaluatorSheet = ({
    open,
    editing,
    onClose,
    onSaved,
}: {
    open: boolean
    /** The evaluator to edit; null creates one. */
    editing: EvaluatorEntry | null
    onClose: () => void
    /** After a save; the lists are already loading again. */
    onSaved?: () => void
}) => {
    const {save, saving} = useSaveHumanEvaluator()
    const [serverError, setServerError] = useState<Exclude<
        SaveHumanEvaluatorResult,
        {ok: true}
    > | null>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const initial = useMemo<HumanEvaluatorDraft>(
        () => (editing ? draftFromEvaluator(editing) : emptyHumanEvaluatorDraft()),
        [editing],
    )

    const close = () => {
        if (saving) return
        setServerError(null)
        onClose()
    }

    const submit = async (draft: HumanEvaluatorDraft) => {
        setServerError(null)
        const result = await save(draft, editing)
        if (!result.ok) {
            setServerError(result)
            return
        }
        message.success(editing ? "Evaluator updated" : "Evaluator created")
        onSaved?.()
        onClose()
    }

    return (
        <Sheet open={open} onOpenChange={(next) => !next && close()}>
            <SheetContent
                side="responsive"
                style={SHEET_WIDTH}
                className="overflow-hidden"
                ref={contentRef}
                onEscapeKeyDown={(event) => {
                    // Escape in a portaled select belongs to it, not to the sheet.
                    const fromSheet = contentRef.current?.contains(event.target as Node) ?? false
                    if (saving || !fromSheet) event.preventDefault()
                }}
                onPointerDownOutside={(event) => saving && event.preventDefault()}
                onInteractOutside={(event) => saving && event.preventDefault()}
            >
                <SheetHeader showCloseButton={!saving}>
                    <SheetTitle>{editing ? "Edit evaluator" : "Create human evaluator"}</SheetTitle>
                    <SheetDescription className="sr-only">
                        Name the evaluator and set the feedback a reviewer gives.
                    </SheetDescription>
                </SheetHeader>
                {open ? (
                    <HumanEvaluatorForm
                        // A new target starts a fresh form.
                        key={editing?.workflow.id ?? "new"}
                        initial={initial}
                        mode={editing ? "edit" : "create"}
                        saving={saving}
                        serverError={serverError}
                        onSubmit={(draft) => void submit(draft)}
                        onCancel={close}
                    />
                ) : null}
            </SheetContent>
        </Sheet>
    )
}
