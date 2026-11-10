import {useCallback, useRef, useState} from "react"

import {simpleQueueMolecule} from "@agenta/entities/simpleQueue"
import {message} from "@agenta/ui/app-message"
import {useSetAtom} from "jotai"

const FAILURE_TEXT = "Couldn't save the changes"

interface Draft {
    name: string
    description: string
}

/**
 * The name and description fields of a queue's Configuration tab. The fields show the saved
 * values until the user types. Save sends both to the server; Reset drops the edits. A second
 * Save while the request runs sends nothing.
 */
export const useQueueDetailsForm = ({
    queueId,
    savedName,
    savedDescription,
}: {
    queueId: string
    savedName: string
    savedDescription: string
}) => {
    const edit = useSetAtom(simpleQueueMolecule.actions.edit)
    const [draft, setDraft] = useState<Draft | null>(null)
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const inFlight = useRef(false)

    const name = draft?.name ?? savedName
    const description = draft?.description ?? savedDescription
    const changed =
        name.trim() !== savedName.trim() || description.trim() !== savedDescription.trim()
    const nameError = draft && !name.trim() ? "Enter a name" : null

    const update = useCallback(
        (next: Partial<Draft>) => {
            setError(null)
            setDraft((current) => ({
                name: current?.name ?? savedName,
                description: current?.description ?? savedDescription,
                ...next,
            }))
        },
        [savedName, savedDescription],
    )

    const reset = useCallback(() => {
        if (inFlight.current) return
        setDraft(null)
        setError(null)
    }, [])

    const save = useCallback(async () => {
        if (inFlight.current || !changed || !name.trim()) return
        inFlight.current = true
        setIsSaving(true)
        setError(null)
        try {
            const saved = await edit(queueId, {name: name.trim(), description: description.trim()})
            if (!saved) throw new Error("The server did not save the queue")
            message.success("Saved")
            setDraft(null)
        } catch (cause) {
            console.error("Saving the annotation queue details failed", cause)
            setError(FAILURE_TEXT)
        } finally {
            inFlight.current = false
            setIsSaving(false)
        }
    }, [edit, queueId, name, description, changed])

    return {name, description, changed, nameError, isSaving, error, update, reset, save}
}
