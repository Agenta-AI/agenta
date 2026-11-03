import {useCallback, useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {generateId} from "@agenta/shared/utils"
import {useStore} from "jotai"

import {asRecord, refinePrompt, toPromptTemplate, type PromptTemplate} from "./refinePromptApi"

/** One round: what the user asked for and the tool's answer (or the failure message). */
export interface RefineRound {
    id: string
    guidelines: string
    reply: string
    failed: boolean
}

export const REFINE_FAILED = "Couldn't refine the prompt. Try again."

/**
 * The refine conversation for one prompt of one revision. The state lives in the dialog, so it
 * is gone when the dialog closes. Each round refines the result of the round before; `refine`
 * resolves to whether the round worked. `apply` writes the result into the revision's draft (it
 * saves nothing).
 */
export function useRefinePrompt(revisionId: string, promptKey: string) {
    const store = useStore()
    const [rounds, setRounds] = useState<RefineRound[]>([])
    const [pending, setPending] = useState<string | null>(null)
    /** The prompt as it was before the first round, for the diff. */
    const [original, setOriginal] = useState<PromptTemplate | null>(null)
    const [working, setWorking] = useState<PromptTemplate | null>(null)
    /** Grows with each result, so the message editors start again from the new text. */
    const [version, setVersion] = useState(0)

    const refine = useCallback(
        async (input: string) => {
            const guidelines = input.trim()
            if (!guidelines || pending !== null) return false
            setPending(guidelines)
            const round = {id: generateId(), guidelines}
            try {
                const config = store.get(workflowMolecule.selectors.configuration(revisionId))
                const base = working ?? toPromptTemplate(config?.[promptKey])
                if (!base) throw new Error(`The prompt "${promptKey}" has no messages`)
                const {messages, summary} = await refinePrompt(base, guidelines)
                setOriginal((current) => current ?? base)
                setWorking({...base, messages})
                setVersion((current) => current + 1)
                setRounds((current) => [...current, {...round, reply: summary, failed: false}])
                return true
            } catch (error) {
                console.error("Failed to refine prompt:", error)
                setRounds((current) => [...current, {...round, reply: REFINE_FAILED, failed: true}])
                return false
            } finally {
                setPending(null)
            }
        },
        [pending, promptKey, revisionId, store, working],
    )

    const editMessage = useCallback((index: number, field: "role" | "content", value: string) => {
        setWorking((current) =>
            current
                ? {
                      ...current,
                      messages: current.messages.map((message, i) =>
                          i === index ? {...message, [field]: value} : message,
                      ),
                  }
                : current,
        )
    }, [])

    /**
     * Puts the refined messages into the draft and keeps the prompt's other fields. A message at
     * the same place with the same role keeps its other fields too (a name, tool calls).
     */
    const apply = useCallback(() => {
        if (!working) return
        const config = store.get(workflowMolecule.selectors.configuration(revisionId)) ?? {}
        const prompt = asRecord(config[promptKey])
        const saved = Array.isArray(prompt.messages) ? prompt.messages.map(asRecord) : []
        const keepFields = saved.length === working.messages.length
        const messages = working.messages.map((message, index) =>
            keepFields && saved[index].role === message.role
                ? {...saved[index], ...message}
                : message,
        )
        store.set(workflowMolecule.actions.updateConfiguration, revisionId, {
            ...config,
            [promptKey]: {...prompt, messages},
        })
    }, [promptKey, revisionId, store, working])

    return {rounds, pending, original, working, version, refine, editMessage, apply}
}
