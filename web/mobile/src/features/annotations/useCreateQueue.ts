import {useCallback, useRef, useState} from "react"

import {createQueueDrawerOpenAtom, createQueueDrawerSelectionAtom} from "@agenta/annotation"
import {
    createSimpleQueueAtom,
    simpleQueueMolecule,
    type CreateSimpleQueuePayload,
} from "@agenta/entities/simpleQueue"
import {projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {createQueueFollowUpAtom} from "./createQueueFollowUpAtom"
import type {CreateQueueValues} from "./createQueueTypes"
import {useQueueLink} from "./useQueueLink"

const ITEM_LABEL = {traces: "traces", testcases: "test cases"} as const

/**
 * Create one queue from the form values, then add the selected items when the sheet opened with a
 * selection. Every failure shows a fixed sentence; the detail goes to the console.
 */
export const useCreateQueue = () => {
    const queueLink = useQueueLink()
    const projectId = useAtomValue(projectIdAtom)
    const selection = useAtomValue(createQueueDrawerSelectionAtom)
    const setSelection = useSetAtom(createQueueDrawerSelectionAtom)
    const setOpen = useSetAtom(createQueueDrawerOpenAtom)
    const [followUp, setFollowUp] = useAtom(createQueueFollowUpAtom)
    const createQueue = useSetAtom(createSimpleQueueAtom)
    const addTraces = useSetAtom(simpleQueueMolecule.actions.addTraces)
    const addTestcases = useSetAtom(simpleQueueMolecule.actions.addTestcases)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const inFlight = useRef(false)

    /** Close the sheet and forget the selection. It does nothing while a request runs. */
    const close = useCallback(() => {
        if (inFlight.current) return
        setSelection(null)
        setFollowUp(null)
        setOpen(false)
    }, [setFollowUp, setOpen, setSelection])

    const submit = useCallback(
        async (values: CreateQueueValues) => {
            if (inFlight.current) return
            if (!projectId) {
                message.error("Project is not available")
                return
            }
            // The items go into the new queue: the sheet's selection, or the picker's follow-up.
            const itemType = selection?.itemType ?? followUp?.itemType
            if (itemType && values.kind !== itemType) {
                message.error(
                    `Selected ${ITEM_LABEL[itemType]} can only be added to a ${itemType} queue`,
                )
                return
            }

            inFlight.current = true
            setIsSubmitting(true)
            const finish = () => {
                setSelection(null)
                setFollowUp(null)
                setOpen(false)
            }

            try {
                const evaluatorRevisionIds = values.evaluators.map(
                    (evaluator) => evaluator.revisionId,
                )
                const payload: CreateSimpleQueuePayload = {
                    name: values.name,
                    description: values.description || null,
                    data: {
                        kind: values.kind,
                        evaluators:
                            evaluatorRevisionIds.length > 0 ? evaluatorRevisionIds : undefined,
                        repeats: 1,
                    },
                }
                const queue = await createQueue(payload)
                if (!queue) {
                    message.error("Failed to create annotation queue")
                    return
                }

                if (selection?.itemIds.length) {
                    let added: string | null = null
                    try {
                        added =
                            selection.itemType === "traces"
                                ? await addTraces(queue.id, selection.itemIds)
                                : await addTestcases(queue.id, selection.itemIds)
                    } catch (cause) {
                        console.error("Adding the selection to the new queue failed", cause)
                    }
                    if (!added) {
                        finish()
                        message.error(
                            `Queue was created, but failed to add the selected ${ITEM_LABEL[selection.itemType]}`,
                        )
                        return
                    }
                }

                finish()
                message.success({
                    content: "Annotation queue created.",
                    ...queueLink(queue.id, `View "${queue.name ?? "queue"}"`),
                    duration: 5,
                })
                followUp?.run(queue)
            } catch (cause) {
                console.error("Creating the annotation queue failed", cause)
                message.error("Couldn't create the queue")
            } finally {
                inFlight.current = false
                setIsSubmitting(false)
            }
        },
        [
            addTestcases,
            addTraces,
            createQueue,
            followUp,
            projectId,
            queueLink,
            selection,
            setFollowUp,
            setOpen,
            setSelection,
        ],
    )

    return {submit, close, isSubmitting, selection, followUp}
}
