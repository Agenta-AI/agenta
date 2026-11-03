import {useCallback, useRef, useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {asRecord, generateId} from "@agenta/shared/utils"
import {useStore} from "jotai"

import {refinePrompt, toPromptTemplate, type PromptTemplate} from "./refinePromptApi"

/** One round: what the user asked for and the tool's answer (or the failure message). */
export interface RefineRound {
    id: string
    guidelines: string
    reply: string
    failed: boolean
}

const REFINE_FAILED = "Couldn't refine the prompt. Try again."

/**
 * The refine conversation for one prompt of one revision. The state lives in the dialog, so it
 * is gone when the dialog closes. Each round refines the result of the round before; `refine`
 * ignores a call while a round runs and resolves to whether the round worked. `apply` writes the result into the revision's draft (it
 * saves nothing).
 */
export function useRefinePrompt(revisionId: string, promptKey: string) {
    const store = useStore()
    const [rounds, setRounds] = useState<RefineRound[]>([])
    const [pending, setPending] = useState<string | null>(null)
    /** The prompt as it was before the first round, for the diff. */
    const [original, setOriginal] = useState<PromptTemplate | null>(null)
    const [working, setWorking] = useState<PromptTemplate | null>(null)
    /** Set at once, so a second call in the same tick sees the running round. */
    const running = useRef(false)

    const refine = useCallback(
        async (input: string) => {
            const guidelines = input.trim()
            if (!guidelines || running.current) return false
            running.current = true
            setPending(guidelines)
            const round = {id: generateId(), guidelines}
            try {
                const config = store.get(workflowMolecule.selectors.configuration(revisionId))
                const base = working ?? toPromptTemplate(config?.[promptKey])
                if (!base) throw new Error(`The prompt "${promptKey}" has no messages`)
                const {messages, summary} = await refinePrompt(base, guidelines)
                setOriginal((current) => current ?? base)
                setWorking({...base, messages})
                setRounds((current) => [...current, {...round, reply: summary, failed: false}])
                return true
            } catch (error) {
                console.error("Failed to refine prompt:", error)
                setRounds((current) => [...current, {...round, reply: REFINE_FAILED, failed: true}])
                return false
            } finally {
                running.current = false
                setPending(null)
            }
        },
        [promptKey, revisionId, store, working],
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
        const prompt = asRecord(config[promptKey]) ?? {}
        const saved = Array.isArray(prompt.messages)
            ? prompt.messages.map((message) => asRecord(message) ?? {})
            : []
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

    /** Grows with each result, so the message editors start again from the new text. */
    const version = rounds.filter((round) => !round.failed).length

    return {rounds, pending, original, working, version, refine, editMessage, apply}
}
