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

import {useCallback, useRef} from "react"

import {generateId} from "@agenta/shared/utils"
import {useAtomValue, useSetAtom} from "jotai"

import {aiServicesApi} from "@/oss/services/aiServices/api"
import {moleculeBackedPromptsAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"

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
    variantId: string
    promptId: string
}

interface UseRefinePromptReturn {
    refine: (guidelines: string) => Promise<void>
    isLoading: boolean
}

/**
 * Extract a simple PromptTemplate from the enhanced prompt structure.
 */
function extractPromptTemplate(enhancedPrompt: any): PromptTemplate | null {
    if (!enhancedPrompt) return null

    const messagesValue = enhancedPrompt?.messages?.value
    if (!Array.isArray(messagesValue)) return null

    const messages = messagesValue.map((msg: any) => {
        const role = msg?.role?.value || msg?.role || "user"
        let content = ""

        const contentValue = msg?.content?.value ?? msg?.content
        if (typeof contentValue === "string") {
            content = contentValue
        } else if (Array.isArray(contentValue)) {
            content = contentValue
                .map((part: any) => part?.text?.value ?? part?.text ?? "")
                .filter(Boolean)
                .join("\n")
        } else if (contentValue && typeof contentValue === "object") {
            content = JSON.stringify(contentValue)
        }

        return {role, content}
    })

    return {
        messages,
        template_format: enhancedPrompt?.template_format?.value || "",
    }
}

/**
 * Parse the refined prompt from API response.
 *
 * The backend returns { messages: [...], summary: "..." } in structuredContent.
 * We preserve the original template_format since refinement only changes message content.
 */
function parseRefineResponse(
    response: any,
    originalTemplateFormat: string,
): {
    refinedPrompt: PromptTemplate | null
    explanation: string
} {
    const structured = response?.structuredContent
    const explanation = structured?.summary || "Prompt refined successfully."

    if (structured?.messages && Array.isArray(structured.messages)) {
        return {
            refinedPrompt: {
                messages: structured.messages,
                template_format: originalTemplateFormat,
            },
            explanation,
        }
    }

    return {refinedPrompt: null, explanation}
}

export function useRefinePrompt({
    variantId,
    promptId,
}: UseRefinePromptParams): UseRefinePromptReturn {
    const enhancedPrompts = useAtomValue(moleculeBackedPromptsAtomFamily(variantId))

    // Setters (stable references from Jotai)
    const setOriginalSnapshot = useSetAtom(originalPromptSnapshotAtomFamily(promptId))
    const setWorkingPrompt = useSetAtom(workingPromptAtomFamily(promptId))
    const setWorkingPromptVersion = useSetAtom(workingPromptVersionAtomFamily(promptId))
    const setIterations = useSetAtom(refineIterationsAtomFamily(promptId))
    const setLoading = useSetAtom(refineLoadingAtomFamily(promptId))
    const setPendingGuidelines = useSetAtom(pendingGuidelinesAtomFamily(promptId))

    const isLoading = useAtomValue(refineLoadingAtomFamily(promptId))

    // Use refs for values only read inside callbacks to keep refine stable
    const workingPromptRef = useRef<PromptTemplate | null>(null)
    const originalSnapshotRef = useRef<PromptTemplate | null>(null)
    const enhancedPromptsRef = useRef(enhancedPrompts)

    // Sync refs on each render
    const workingPrompt = useAtomValue(workingPromptAtomFamily(promptId))
    const originalSnapshot = useAtomValue(originalPromptSnapshotAtomFamily(promptId))
    workingPromptRef.current = workingPrompt
    originalSnapshotRef.current = originalSnapshot
    enhancedPromptsRef.current = enhancedPrompts

    const refine = useCallback(
        async (guidelines: string) => {
            if (!guidelines.trim()) return

            setLoading(true)
            setPendingGuidelines(guidelines)

            try {
                // Find the prompt by ID
                const promptList = Array.isArray(enhancedPromptsRef.current)
                    ? enhancedPromptsRef.current
                    : []
                const enhancedPrompt =
                    promptList.find((p: any) => p?.__id === promptId) ||
                    promptList.find((p: any) => p?.__name === promptId) ||
                    promptList[0]

                if (!enhancedPrompt) {
                    throw new Error("Prompt not found")
                }

                // Use working prompt if we have one, else extract from enhanced
                let promptToRefine = workingPromptRef.current
                if (!promptToRefine) {
                    promptToRefine = extractPromptTemplate(enhancedPrompt)
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
            promptId,
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
