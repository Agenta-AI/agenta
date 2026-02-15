/**
 * Types for the Refine Prompt Modal
 *
 * Key insight: This is NOT a chat conversation. The API takes:
 * - prompt_template_json: The prompt to refine
 * - guidelines: User's refinement instructions
 *
 * And returns:
 * - messages: The refined messages array
 * - summary: Short description of what changed
 *
 * The UI presents this as a chat-like interface, but the state models it as refinement iterations.
 */

/**
 * A single refinement iteration - represents one round of user guidelines + AI response
 */
export interface RefinementIteration {
    /** Unique identifier for this iteration */
    id: string
    /** User's refinement instructions (what they asked for) */
    guidelines: string
    /** AI's explanation of what changes were made */
    explanation: string
    /** When this iteration was created */
    timestamp: number
}

/**
 * Prompt template structure (matches backend contract)
 */
export interface PromptTemplate {
    messages: {
        role: string
        content: string
    }[]
    template_format?: string
    input_keys?: string[]
    llm_config?: Record<string, unknown>
}

/**
 * Props for the RefinePromptModal component
 */
export interface RefinePromptModalProps {
    open: boolean
    onClose: () => void
    variantId: string
    promptId: string
}

/**
 * Props for the InstructionsPanel (left side)
 */
export interface InstructionsPanelProps {
    iterations: RefinementIteration[]
    pendingGuidelines: string | null
    isLoading: boolean
    onSubmitGuidelines: (guidelines: string) => void
}

/**
 * Props for the PreviewPanel (right side)
 */
export interface PreviewPanelProps {
    originalPrompt: PromptTemplate | null
    workingPrompt: PromptTemplate | null
    showDiff: boolean
    isLoading: boolean
    onToggleDiff: (show: boolean) => void
    onClose: () => void
    onUpdateMessage: (index: number, field: "role" | "content", value: string) => void
}

/**
 * Props for the modal content (two-column layout)
 */
export interface RefinePromptModalContentProps {
    variantId: string
    promptId: string
    onClose: () => void
}
