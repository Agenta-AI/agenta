/**
 * MarkdownEditor
 *
 * A Markdown-aware editor for Markdown string fields (SKILL.md body, AGENTS.md instructions). It
 * wraps the shared Lexical editor in rich-text mode — the same editor the config message editors
 * use — so it carries the same text ↔ markdown-source view toggle. Prompt-variable tokens are
 * disabled (these are documents, not templated prompts).
 *
 * It defaults to the Markdown *source* (plaintext) view; rendering Markdown is an explicit toggle.
 * The shared MarkdownPlugin only swaps view on a `SET_MARKDOWN_VIEW` command (the storage atom
 * alone doesn't), so the view is driven by local `markdownView` state via a small synchronizer
 * mounted inside the composer (after the editor, so the command is registered). The toggle button
 * just flips that state; it doesn't need composer context.
 *
 * The whole subtree mounts under an `EditorProvider` with `noProvider` on the editor, so the editor
 * and its header (where the toggle sits) share one composer context.
 *
 * Controlled: seeds from `value` and re-syncs when `value` changes from outside (e.g. a skill
 * upload populating the body), while leaving the cursor alone during local typing.
 */
import {useEffect, useId, useLayoutEffect, useRef, useState} from "react"

import {EditorProvider, SET_MARKDOWN_VIEW, useLexicalComposerContext} from "@agenta/ui"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {MarkdownLogoIcon, TextAa} from "@phosphor-icons/react"
import {Button, Tag, Tooltip} from "antd"

export interface MarkdownEditorProps {
    value: string
    onChange: (next: string) => void
    placeholder?: string
    disabled?: boolean
    /** Optional file-name tag shown on the left of the editor toolbar (e.g. "AGENTS.md"). Fills
     * the toolbar band the view toggle would otherwise leave empty. */
    filename?: string
}

/**
 * Dispatches `SET_MARKDOWN_VIEW` whenever the desired view changes so the Lexical editor swaps
 * between rich-text and markdown-source. Mirrors the chat editor's synchronizer: a layout effect
 * handles updates, and a post-paint `requestAnimationFrame` re-dispatch covers the initial-mount
 * race where this effect can fire before the descendant MarkdownPlugin registers the command.
 */
function MarkdownViewSync({enabled}: {enabled: boolean}) {
    const [editor] = useLexicalComposerContext()

    useLayoutEffect(() => {
        editor.dispatchCommand(SET_MARKDOWN_VIEW, enabled)
    }, [editor, enabled])

    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            editor.dispatchCommand(SET_MARKDOWN_VIEW, enabled)
        })
        return () => cancelAnimationFrame(frame)
    }, [editor, enabled])

    return null
}

export function MarkdownEditor({
    value,
    onChange,
    placeholder,
    disabled,
    filename,
}: MarkdownEditorProps) {
    // Stable id shared by the provider and the editor so they target one composer. Colons from
    // useId() are dropped to keep it id/atom-key safe.
    const reactId = useId()
    const editorId = `md${reactId.replace(/:/g, "")}`

    const [text, setText] = useState(value ?? "")
    const lastExternal = useRef(value ?? "")
    // Default to the Markdown source (plaintext) view — rendering Markdown is an explicit toggle.
    const [markdownView, setMarkdownView] = useState(true)

    // Re-seed only when the value changes from outside (not on our own edits), so an upload that
    // sets the body flows in without fighting the cursor during typing.
    useEffect(() => {
        const next = value ?? ""
        if (next !== lastExternal.current) {
            lastExternal.current = next
            setText(next)
        }
    }, [value])

    const handleChange = (next: string) => {
        setText(next)
        lastExternal.current = next
        onChange(next)
    }

    return (
        <EditorProvider
            id={editorId}
            codeOnly={false}
            enableTokens={false}
            showToolbar={false}
            disabled={disabled}
        >
            <SharedEditor
                id={editorId}
                noProvider
                editorType="border"
                initialValue={text}
                value={text}
                handleChange={handleChange}
                disabled={disabled}
                placeholder={placeholder}
                editorProps={{codeOnly: false, enableTokens: false, noProvider: true}}
                syncWithInitialValueChanges
                header={
                    <div className="flex w-full items-center justify-between gap-2">
                        {filename ? (
                            <Tag
                                bordered
                                className="m-0 font-mono text-[11px] font-normal text-[var(--ag-c-586673,#586673)]"
                            >
                                {filename}
                            </Tag>
                        ) : (
                            <span />
                        )}
                        <Tooltip title={markdownView ? "Preview markdown" : "Edit source"}>
                            <Button
                                type="text"
                                icon={
                                    markdownView ? (
                                        <MarkdownLogoIcon size={14} />
                                    ) : (
                                        <TextAa size={14} />
                                    )
                                }
                                onClick={() => setMarkdownView((v) => !v)}
                                disabled={disabled}
                            />
                        </Tooltip>
                    </div>
                }
            />
            <MarkdownViewSync enabled={markdownView} />
        </EditorProvider>
    )
}
