import {LexicalComposer} from "@lexical/react/LexicalComposer"
import {EditorState, LexicalEditor} from "lexical"
import {$getRoot} from "lexical"
import {useEditorResize} from "./hooks/useEditorResize"
import {useEditorInvariant} from "./hooks/useEditorInvariant"
import {useEditorConfig} from "./hooks/useEditorConfig"
import EditorPlugins from "./plugins"

import type {EditorProps} from "./types"
import {useCallback} from "react"
/**
 * Editor component
 *
 * @param {string} id - Unique identifier for the editor instance.
 * @param {string} initialValue - Initial value of the editor content.
 * @param {function} onChange - Callback function to handle content changes.
 * @param {string} placeholder - Placeholder text for the editor.
 * @param {boolean} singleLine - If true, the editor will be single-line.
 * @param {boolean} codeOnly - If true, the editor will be in code-only mode.
 * @param {string} language - Programming language for code highlighting.
 * @param {boolean} showToolbar - If true, the toolbar will be shown.
 * @param {boolean} enableTokens - If true, token functionality will be enabled.
 * @param {boolean} enableResize - If true, the editor will be resizable.
 * @param {boolean} boundWidth - If true, the editor width will be bounded to the parent width.
 * @param {boolean} boundHeight - If true, the editor height will be bounded to the parent height.
 * @param {boolean} debug - If true, debug information will be shown.
 */
export function Editor({
    id = crypto.randomUUID(),
    initialValue = "",
    onChange,
    placeholder = "Enter some text...",
    singleLine = false,
    codeOnly = false,
    language,
    showToolbar = true,
    enableTokens = false,
    debug = false,
    enableResize = false, // New prop
    boundWidth = true, // New prop
    boundHeight, // New prop
}: EditorProps) {
    useEditorInvariant({
        singleLine,
        enableResize,
        codeOnly,
        enableTokens,
        showToolbar,
        language,
    })

    const {containerRef, dimensions} = useEditorResize({
        singleLine,
        enableResize,
        boundWidth,
        boundHeight,
    })

    const config = useEditorConfig({
        id,
        initialValue,
        codeOnly,
        enableTokens,
    })

    const handleUpdate = useCallback(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (editorState: EditorState, _editor: LexicalEditor) => {
            editorState.read(() => {
                const root = $getRoot()
                const textContent = root.getTextContent()
                const tokens: unknown[] = [] // Extract tokens if needed

                const result = {
                    value: "", // Omit this for now
                    textContent,
                    tokens,
                }

                if (onChange) {
                    onChange(result)
                }
            })
        },
        [onChange],
    )

    if (!config) {
        return (
            <div
                className="bg-white relative flex flex-col p-2 border rounded-lg"
                style={
                    dimensions.width
                        ? {
                              width: dimensions.width,
                              height: dimensions.height,
                          }
                        : undefined
                }
            >
                <div className="editor-placeholder">{placeholder}</div>
            </div>
        )
    }

    return (
        <div className="bg-white relative flex flex-col p-2">
            <LexicalComposer initialConfig={config}>
                <div className="editor-container overflow-hidden relative">
                    <div
                        ref={containerRef}
                        className={`editor-inner border rounded-lg ${singleLine ? "single-line" : ""}`}
                        style={
                            dimensions.width
                                ? {
                                      width: dimensions.width,
                                      height: dimensions.height,
                                  }
                                : undefined
                        }
                    >
                        <EditorPlugins
                            showToolbar={showToolbar}
                            singleLine={singleLine}
                            codeOnly={codeOnly}
                            enableTokens={enableTokens}
                            debug={debug}
                            language={language}
                            placeholder={placeholder}
                            handleUpdate={handleUpdate}
                        />
                        {!singleLine && enableResize && <div className="resize-handle" />}
                    </div>
                </div>
            </LexicalComposer>
        </div>
    )
}
