/**
 * @module Editor
 *
 * A comprehensive text editor built on Lexical with support for:
 * - JSON/YAML syntax highlighting
 * - Markdown editing
 * - Token/variable highlighting
 * - Form view for structured data
 * - Diff visualization
 *
 * @example Basic Usage
 * ```tsx
 * import {Editor} from '@agenta/ui'
 *
 * <Editor
 *   initialValue='{"key": "value"}'
 *   language="json"
 *   codeOnly
 *   onChange={({textContent}) => console.log(textContent)}
 * />
 * ```
 *
 * @example With Diff View
 * ```tsx
 * import {DiffView} from '@agenta/ui'
 *
 * <DiffView
 *   language="json"
 *   original='{"version": "1.0"}'
 *   modified='{"version": "2.0"}'
 * />
 * ```
 */

// Main Editor component
export {default as Editor, EditorProvider} from "./Editor"
export {ON_HYDRATE_FROM_REMOTE_CONTENT, useLexicalComposerContext} from "./Editor"

// DiffView component
export {default as DiffView} from "./DiffView"

// Types
export type {EditorProps, EditorPluginsProps, EditorContextType, EditorProviderProps} from "./types"

// State management
export {EditorStateProvider} from "./state"
export {editorStateAtom, markdownViewAtom} from "./state/assets/atoms"

// Code editor utilities
export {
    createHighlightedNodes,
    TOGGLE_FORM_VIEW,
    DRILL_IN_TO_PATH,
    ON_CHANGE_LANGUAGE,
    PropertyClickPlugin,
} from "./plugins/code"
export {$getEditorCodeAsString} from "./plugins/code/plugins/RealTimeValidationPlugin"
export {DrillInProvider} from "./plugins/code/context/DrillInContext"

// JSON parsing utilities - Re-exported from @agenta/shared
export {tryParsePartialJson, safeJson5Parse} from "@agenta/shared"

// Markdown utilities
export {TOGGLE_MARKDOWN_VIEW} from "./plugins/markdown/commands"
export {ON_CHANGE_COMMAND} from "./plugins/markdown/commands"
export {
    $convertToMarkdownStringCustom,
    PLAYGROUND_TRANSFORMERS,
} from "./plugins/markdown/assets/transformers"

// Form view types
export type {CustomRenderFn} from "./form/nodes/NodeTypes"

// Hooks
export {default as useEditorConfig} from "./hooks/useEditorConfig"
export {useEditorInvariant} from "./hooks/useEditorInvariant"
export {useEditorResize} from "./hooks/useEditorResize"

// Commands
export {INITIAL_CONTENT_COMMAND} from "./commands/InitialContentCommand"
export type {InitialContentPayload} from "./commands/InitialContentCommand"
