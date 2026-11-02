import {useCallback, useRef, useState} from "react"

import {simpleQueueMolecule} from "@agenta/entities/simpleQueue"
import {message} from "@agenta/ui/app-message"
import {useSetAtom} from "jotai"

export interface QueueToDelete {
    id: string
    name?: string | null
}

const FAILURE_TEXT = "Couldn't delete this queue"

/** Delete one queue after a confirm. A second confirm while the request runs sends nothing. */
export const useQueueDelete = () => {
    const deleteQueue = useSetAtom(simpleQueueMolecule.actions.deleteQueue)
    const [target, setTarget] = useState<QueueToDelete | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const inFlight = useRef(false)

    const requestDelete = useCallback((queue: QueueToDelete) => {
        setError(null)
        setTarget(queue)
    }, [])

    const cancel = useCallback(() => {
        if (inFlight.current) return
        setTarget(null)
        setError(null)
    }, [])

    const confirm = useCallback(async () => {
        if (!target || inFlight.current) return
        inFlight.current = true
        setIsDeleting(true)
        setError(null)
        try {
            const deleted = await deleteQueue(target.id)
            if (!deleted) throw new Error("The server did not delete the queue")
            message.success("Deleted successfully")
            setTarget(null)
        } catch (cause) {
            console.error("Deleting the annotation queue failed", cause)
            setError(FAILURE_TEXT)
        } finally {
            inFlight.current = false
            setIsDeleting(false)
        }
    }, [deleteQueue, target])

    return {target, isOpen: target !== null, requestDelete, confirm, cancel, isDeleting, error}
}
