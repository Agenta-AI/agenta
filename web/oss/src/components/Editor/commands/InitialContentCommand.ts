/**
 * @fileoverview Custom Lexical command for handling initial content
 *
 * This command allows plugins to intercept and handle initial content processing
 * before the default InsertInitialCodeBlockPlugin logic runs.
 */

import {createCommand, LexicalCommand} from "lexical"

export interface InitialContentPayload {
    /** The initial content to be processed */
    content: string
    /** The language for syntax highlighting */
    language: "json" | "yaml"
    /** Whether this content should be handled by the default plugin */
    preventDefault: () => void
    /** Whether default handling has been prevented */
    isDefaultPrevented: () => boolean
    /** Optional: Original content for diff computation */
    originalContent?: string
    /** Optional: Modified content for diff computation */
    modifiedContent?: string
    /** Optional: Flag to indicate this is a diff request */
    isDiffRequest?: boolean
}

/**
 * Command dispatched when initial content needs to be processed
 * Plugins can listen to this command to handle specific content types
 */
export const INITIAL_CONTENT_COMMAND: LexicalCommand<InitialContentPayload> =
    createCommand("INITIAL_CONTENT_COMMAND")
