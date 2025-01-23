import {useEffect} from "react"
import type {EditorProps} from "../types"

export function useEditorInvariant({
    singleLine,
    enableResize,
    codeOnly,
    enableTokens,
    showToolbar,
    language,
}: Pick<
    EditorProps,
    "singleLine" | "enableResize" | "codeOnly" | "enableTokens" | "showToolbar" | "language"
>) {
    useEffect(() => {
        if (singleLine && enableResize) {
            throw new Error(
                "Invalid configuration: 'singleLine' and 'enableResize' cannot be used together.",
            )
        }
        if (singleLine && codeOnly) {
            throw new Error(
                "Invalid configuration: 'singleLine' and 'codeOnly' cannot be used together.",
            )
        }
        if (codeOnly && enableTokens) {
            throw new Error(
                "Invalid configuration: 'codeOnly' and 'enableTokens' cannot be used together.",
            )
        }
        if (codeOnly && showToolbar) {
            throw new Error(
                "Invalid configuration: 'codeOnly' and 'showToolbar' cannot be used together.",
            )
        }
        if (singleLine && showToolbar) {
            throw new Error(
                "Invalid configuration: 'singleLine' and 'showToolbar' cannot be used together.",
            )
        }
        if (language && !codeOnly) {
            throw new Error("Invalid configuration: 'language' prop is only valid with 'codeOnly'.")
        }
    }, [singleLine, enableResize, codeOnly, enableTokens, showToolbar, language])
}
