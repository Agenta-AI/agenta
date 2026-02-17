/**
 * useRefinePrompt - Hook for refining prompts using AI
 *
 * This hook handles:
 * 1. Capturing the original prompt on first refinement
 * 2. Calling the refine prompt API
 * 3. Updating iterations history and working prompt state
 *
 * Uses refs for values only needed inside callbacks (workingPrompt,
 * originalSnapshot) to keep the `refine` callback stable and avoid
 * stale closures without re-creating it on every state change.
 */

import {useCallback, useMemo, useRef} from "react"

import {legacyAppRevisionMolecule} from "@agenta/entities/legacyAppRevision"
import {generateId} from "@agenta/shared/utils"
import {useAtomValue, useSetAtom} from "jotai"

import {aiServicesApi} from "@/oss/services/aiServices/api"

import {
    originalPromptSnapshotAtomFamily,
    pendingGuidelinesAtomFamily,
    refineIterationsAtomFamily,
    refineLoadingAtomFamily,
    workingPromptVersionAtomFamily,
    workingPromptAtomFamily,
} from "../store/refinePromptStore"
import type {PromptTemplate, RefinementIteration} from "../types"

interface UseRefinePromptParams {
    revisionId: string
    promptKey: string
}

interface UseRefinePromptReturn {
    refine: (guidelines: string) => Promise<void>
    isLoading: boolean
}

/**
 * Extract a simple PromptTemplate from the entity's parameters.prompt object.
 *
 * In the new architecture, parameters.prompt contains plain messages:
 * { messages: [{role: "user", content: "..."}], template_format: "curly", ... }
 */
function extractPromptTemplate(promptValue: unknown): PromptTemplate | null {
    if (!promptValue || typeof promptValue !== "object") return null

    const prompt = promptValue as Record<string, unknown>
    const messages = prompt.messages

    if (!Array.isArray(messages) || messages.length === 0) return null

    const extracted = messages
        .map((msg: unknown) => {
            if (!msg || typeof msg !== "object") return null
            const m = msg as Record<string, unknown>
            const role = typeof m.role === "string" ? m.role : "user"
            let content = ""

            if (typeof m.content === "string") {
                content = m.content
            } else if (Array.isArray(m.content)) {
                content = m.content
                    .map((part: unknown) => {
                        if (typeof part === "string") return part
                        if (part && typeof part === "object") {
                            return (part as Record<string, unknown>).text ?? ""
                        }
                        return ""
                    })
                    .filter(Boolean)
                    .join("\n")
            } else if (m.content && typeof m.content === "object") {
                content = JSON.stringify(m.content)
            }

            return {role, content}
        })
        .filter(Boolean) as {role: string; content: string}[]

    return {
        messages: extracted,
        template_format: typeof prompt.template_format === "string" ? prompt.template_format : "",
    }
}

/**
 * Parse the refined prompt from API response.
 *
 * The backend returns { messages: [...], summary: "..." } in structuredContent.
 * We preserve the original template_format since refinement only changes message content.
 */
function parseRefineResponse(
    response: unknown,
    originalTemplateFormat: string,
): {
    refinedPrompt: PromptTemplate | null
    explanation: string
} {
    const structured = (response as Record<string, unknown>)?.structuredContent as
        | Record<string, unknown>
        | undefined
    const explanation = (structured?.summary as string) || "Prompt refined successfully."

    if (structured?.messages && Array.isArray(structured.messages)) {
        return {
            refinedPrompt: {
                messages: structured.messages as {role: string; content: string}[],
                template_format: originalTemplateFormat,
            },
            explanation,
        }
    }

    return {refinedPrompt: null, explanation}
}

export function useRefinePrompt({
    revisionId,
    promptKey,
}: UseRefinePromptParams): UseRefinePromptReturn {
    const dataAtom = useMemo(() => legacyAppRevisionMolecule.atoms.data(revisionId), [revisionId])
    const entityData = useAtomValue(dataAtom)

    // Setters (stable references from Jotai)
    const setOriginalSnapshot = useSetAtom(originalPromptSnapshotAtomFamily(promptKey))
    const setWorkingPrompt = useSetAtom(workingPromptAtomFamily(promptKey))
    const setWorkingPromptVersion = useSetAtom(workingPromptVersionAtomFamily(promptKey))
    const setIterations = useSetAtom(refineIterationsAtomFamily(promptKey))
    const setLoading = useSetAtom(refineLoadingAtomFamily(promptKey))
    const setPendingGuidelines = useSetAtom(pendingGuidelinesAtomFamily(promptKey))

    const isLoading = useAtomValue(refineLoadingAtomFamily(promptKey))

    // Use refs for values only read inside callbacks to keep refine stable
    const workingPromptRef = useRef<PromptTemplate | null>(null)
    const originalSnapshotRef = useRef<PromptTemplate | null>(null)
    const entityDataRef = useRef(entityData)

    // Sync refs on each render
    const workingPrompt = useAtomValue(workingPromptAtomFamily(promptKey))
    const originalSnapshot = useAtomValue(originalPromptSnapshotAtomFamily(promptKey))
    workingPromptRef.current = workingPrompt
    originalSnapshotRef.current = originalSnapshot
    entityDataRef.current = entityData

    const refine = useCallback(
        async (guidelines: string) => {
            if (!guidelines.trim()) return

            setLoading(true)
            setPendingGuidelines(guidelines)

            try {
                // Use working prompt if we have one, else extract from entity data
                let promptToRefine = workingPromptRef.current
                if (!promptToRefine) {
                    const parameters = entityDataRef.current?.parameters as
                        | Record<string, unknown>
                        | undefined
                    const promptValue = parameters?.[promptKey]
                    promptToRefine = extractPromptTemplate(promptValue)
                }

                if (!promptToRefine) {
                    throw new Error("Could not extract prompt template")
                }

                // Capture original snapshot on first refinement
                if (!originalSnapshotRef.current) {
                    setOriginalSnapshot(promptToRefine)
                }

                const response = await aiServicesApi.refinePrompt(promptToRefine, guidelines)

                if (response.isError) {
                    const errorText = response.content?.[0]?.text || "Failed to refine prompt"
                    throw new Error(errorText)
                }

                const {refinedPrompt, explanation} = parseRefineResponse(
                    response,
                    promptToRefine.template_format || "",
                )

                if (!refinedPrompt) {
                    throw new Error("No refined prompt in response")
                }

                setWorkingPrompt(refinedPrompt)
                setWorkingPromptVersion((prev) => prev + 1)

                const iteration: RefinementIteration = {
                    id: generateId(),
                    guidelines,
                    explanation,
                    timestamp: Date.now(),
                }

                setIterations((prev) => [...prev, iteration])
            } catch (error) {
                console.error("Failed to refine prompt:", error)

                const iteration: RefinementIteration = {
                    id: generateId(),
                    guidelines,
                    explanation:
                        error instanceof Error
                            ? `Error: ${error.message}`
                            : "An unexpected error occurred",
                    timestamp: Date.now(),
                }

                setIterations((prev) => [...prev, iteration])
            } finally {
                setLoading(false)
                setPendingGuidelines(null)
            }
        },
        [
            promptKey,
            setOriginalSnapshot,
            setWorkingPrompt,
            setWorkingPromptVersion,
            setIterations,
            setLoading,
            setPendingGuidelines,
        ],
    )

    return {refine, isLoading}
}
