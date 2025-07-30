/**
 * @fileoverview DiffView - Reusable diff visualization component
 *
 * This component provides a complete solution for comparing JSON and YAML content
 * with real-time diff computation, syntax highlighting, and error handling.
 *
 * Features:
 * - Supports both JSON and YAML formats
 * - Real-time diff computation with debouncing
 * - Intelligent incomplete content detection
 * - GitHub-style diff visualization
 * - Customizable styling and behavior
 *
 * Usage:
 * ```tsx
 * import DiffView from "@/oss/components/Editor/DiffView"
 *
 * <DiffView
 *   language="json"
 *   original={originalContent}
 *   modified={modifiedContent}
 *   className="h-96 border rounded-lg"
 *   debounceMs={1000}
 *   showErrors={true}
 * />
 * ```
 */

import React, {useState, useEffect} from "react"

import EditorWrapper from "./Editor"
import {DiffHighlightPlugin} from "./plugins/code/plugins/DiffHighlightPlugin"

/**
 * Reusable DiffView component that handles diff computation and display
 */
export interface DiffViewProps {
    /** The programming language for syntax highlighting */
    language: "json" | "yaml"
    /** Original content as string */
    original: string
    /** Modified content as string */
    modified: string
    /** Optional className for styling */
    className?: string
    /** Debounce timeout in milliseconds (default: 1000) */
    debounceMs?: number
    /** Show error messages when parsing fails */
    showErrors?: boolean
}

const DiffView: React.FC<DiffViewProps> = ({
    language,
    original,
    modified,
    className = "",
    debounceMs = 1000,
    showErrors = true,
}) => {
    const [diffKey, setDiffKey] = useState(0)
    const [error, setError] = useState<string | null>(null)

    // Trigger diff computation with debouncing
    useEffect(() => {
        const timeout = setTimeout(() => {
            try {
                setError(null)
                // Increment key to trigger editor re-render with new diff data
                setDiffKey((prev) => prev + 1)
            } catch (parseError) {
                if (showErrors) {
                    setError(`Invalid ${language.toUpperCase()} format. Please check your syntax.`)
                }
            }
        }, debounceMs)

        return () => clearTimeout(timeout)
    }, [original, modified, language, debounceMs, showErrors])

    return (
        <div className={className}>
            {error && showErrors && (
                <div className="mb-2 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                    {error}
                </div>
            )}
            <EditorWrapper
                key={diffKey}
                initialValue=""
                language={language}
                validationSchema={{}}
                additionalCodePlugins={[
                    <DiffHighlightPlugin
                        key="diff-highlight"
                        originalContent={original}
                        modifiedContent={modified}
                    />,
                ]}
                className="w-full"
                disabled={true}
                codeOnly={true}
                showToolbar={false}
            />
        </div>
    )
}

export default DiffView
