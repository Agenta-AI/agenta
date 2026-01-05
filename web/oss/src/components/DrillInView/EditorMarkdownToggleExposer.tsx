import {useEffect, useCallback, useRef} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"

import {TOGGLE_MARKDOWN_VIEW} from "@/oss/components/Editor/plugins/markdown/commands"

interface EditorMarkdownToggleExposerProps {
    /** Callback to expose the toggle function to the parent */
    onToggleReady: (toggleFn: () => void) => void
}

/**
 * Component that exposes the markdown toggle function from inside the EditorProvider.
 * Must be rendered as a child of EditorProvider/LexicalComposer.
 *
 * @example
 * ```tsx
 * <EditorProvider>
 *   <EditorMarkdownToggleExposer onToggleReady={(fn) => setToggleFn(fn)} />
 *   <SharedEditor ... />
 * </EditorProvider>
 * ```
 */
export function EditorMarkdownToggleExposer({onToggleReady}: EditorMarkdownToggleExposerProps) {
    const [editor] = useLexicalComposerContext()
    const hasRegisteredRef = useRef(false)
    // Store onToggleReady in a ref to avoid dependency issues
    const onToggleReadyRef = useRef(onToggleReady)
    onToggleReadyRef.current = onToggleReady

    const toggleMarkdown = useCallback(() => {
        editor.dispatchCommand(TOGGLE_MARKDOWN_VIEW, undefined)
    }, [editor])

    useEffect(() => {
        // Only register once to avoid infinite loops
        if (!hasRegisteredRef.current) {
            hasRegisteredRef.current = true
            onToggleReadyRef.current(toggleMarkdown)
        }
    }, [toggleMarkdown])

    return null
}
