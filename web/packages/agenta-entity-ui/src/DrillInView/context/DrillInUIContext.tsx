/**
 * DrillInUIContext
 *
 * Context for injecting OSS-specific UI components into the DrillInView system.
 * This allows the package to remain dependency-free while still supporting
 * rich editors and chat message components when provided.
 *
 * Usage:
 * 1. OSS wraps the app with DrillInUIProvider, passing OSS components
 * 2. Package components use useDrillInUI() to get the injected components
 * 3. If components are not provided, fallbacks are used
 */

import {createContext, useContext, type ComponentType, type ReactNode} from "react"

/**
 * Interface for injectable UI components
 */
export interface DrillInUIComponents {
    /**
     * Editor provider component (wraps rich text editor)
     * Used by: TextField, JsonEditorWithLocalState
     */
    EditorProvider?: ComponentType<{
        children: ReactNode
        id?: string
        initialValue?: string
        showToolbar?: boolean
        enableTokens?: boolean
        codeOnly?: boolean
        language?: string
        [key: string]: unknown
    }>

    /**
     * Shared editor component (rich text/JSON editor)
     * Used by: TextField, JsonEditorWithLocalState
     */
    SharedEditor?: ComponentType<{
        editorType?: string
        initialValue?: string
        onChange?: (value: string) => void
        onPropertyClick?: (path: string) => void
        placeholder?: string
        readOnly?: boolean
        [key: string]: unknown
    }>

    /**
     * Chat message list component
     * Used by: MessagesField, MessagesSchemaControl, PromptSchemaControl
     */
    ChatMessageList?: ComponentType<{
        messages: unknown[]

        onChange?: (messages: unknown[]) => void
        editable?: boolean
        showControls?: boolean
        enableTokens?: boolean
        templateFormat?: string
        [key: string]: unknown
    }>

    /**
     * Single chat message editor component
     * Used by: JsonObjectField for editing single message objects
     */
    ChatMessageEditor?: ComponentType<{
        id: string
        role: string
        text: string
        disabled?: boolean
        enableTokens?: boolean
        templateFormat?: string
        onChangeRole?: (role: string) => void
        onChangeText?: (text: string) => void
        headerRight?: ReactNode
        [key: string]: unknown
    }>

    /**
     * Markdown toggle button component
     * Used by: JsonObjectField, TextField for toggling markdown preview
     */
    MarkdownToggleButton?: ComponentType<{
        id: string
        [key: string]: unknown
    }>

    /**
     * Message display function (for notifications like "Copied to clipboard")
     * Used by: DrillInFieldHeader
     */
    showMessage?: (content: string, type?: "success" | "error" | "info") => void

    /**
     * Drill-in context provider (for Editor integration)
     * Used by: DrillInContent, JsonEditorWithLocalState
     */
    DrillInContextProvider?: ComponentType<{
        value: {enabled: boolean}
        children: ReactNode
    }>

    /**
     * SelectLLMProvider component for model selection
     * Used by: GroupedChoiceControl, PromptSchemaControl
     */
    SelectLLMProvider?: ComponentType<{
        showGroup?: boolean
        showAddProvider?: boolean
        showCustomSecretsOnOptions?: boolean
        options?: {label: string; options: {label: string; value: string}[]}[]
        value?: string
        onChange?: (value: string | undefined) => void
        disabled?: boolean
        placeholder?: string
        className?: string
        size?: "small" | "middle" | "large"
        [key: string]: unknown
    }>

    /**
     * Lexical editor context hook
     * Used by: ResponseFormatControl for reading editor content
     */
    useLexicalComposerContext?: () => [unknown]

    /**
     * Get editor code as string function
     * Used by: ResponseFormatControl for extracting JSON from editor
     */
    getEditorCodeAsString?: (editor: unknown) => string

    /**
     * Try parse partial JSON function
     * Used by: ResponseFormatControl for parsing JSON with relaxed syntax
     */
    tryParsePartialJson?: (jsonString: string) => Record<string, unknown>
}

/**
 * Default context value - empty components
 */
const defaultContext: DrillInUIComponents = {}

/**
 * Context for UI component injection
 */
const DrillInUIContext = createContext<DrillInUIComponents>(defaultContext)

/**
 * Provider props
 */
export interface DrillInUIProviderProps {
    children: ReactNode
    components: DrillInUIComponents
}

/**
 * Provider component for injecting UI components
 *
 * @example
 * ```tsx
 * // In OSS app wrapper
 * <DrillInUIProvider
 *   components={{
 *     EditorProvider,
 *     SharedEditor,
 *     ChatMessageList,
 *     showMessage: (content) => message.success(content),
 *   }}
 * >
 *   <App />
 * </DrillInUIProvider>
 * ```
 */
export function DrillInUIProvider({children, components}: DrillInUIProviderProps) {
    return <DrillInUIContext.Provider value={components}>{children}</DrillInUIContext.Provider>
}

/**
 * Hook to access injected UI components
 *
 * @example
 * ```tsx
 * function TextField() {
 *   const { EditorProvider, SharedEditor } = useDrillInUI()
 *
 *   if (!EditorProvider || !SharedEditor) {
 *     return <textarea ... /> // Fallback
 *   }
 *
 *   return (
 *     <EditorProvider>
 *       <SharedEditor ... />
 *     </EditorProvider>
 *   )
 * }
 * ```
 */
export function useDrillInUI(): DrillInUIComponents {
    return useContext(DrillInUIContext)
}

/**
 * Default message handler (console.log fallback)
 */
export const defaultShowMessage = (content: string, type?: "success" | "error" | "info") => {
    const prefix = type ? `[${type.toUpperCase()}]` : "[INFO]"
    console.log(`${prefix} ${content}`)
}
