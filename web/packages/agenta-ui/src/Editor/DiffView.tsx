/**
 * @fileoverview DiffView - Reusable diff visualization component
 *
 * This component provides a complete solution for comparing JSON and YAML content
 * with real-time diff computation, syntax highlighting, and error handling.
 *
 * ## Features:
 * - Supports both JSON and YAML diff visualization
 * - Real-time diff computation with debouncing
 * - Error handling for invalid syntax
 * - Customizable styling and behavior
 * - Flexible input handling (strings or objects)
 *
 * ## Input Format Flexibility:
 * The DiffView component accepts both strings and objects with automatic format handling:
 *
 * ### 1. String Input (JSON or YAML)
 * Pass pre-formatted strings - language will be auto-detected if not specified:
 *
 * **Explicit Language:**
 * ```tsx
 * <DiffView
 *   language="json"
 *   original='{"name": "old-service", "version": "1.0.0"}'
 *   modified='{"name": "new-service", "version": "1.1.0"}'
 * />
 * ```
 *
 * **Auto-Detection:**
 * ```tsx
 * <DiffView
 *   original='{"name": "old-service"}' // Detected as JSON
 *   modified="name: new-service\nversion: 1.1.0" // Detected as YAML
 * />
 * ```
 *
 * ### 2. Object Input
 * Pass JavaScript objects directly - they'll be converted to the target format:
 *
 * ```tsx
 * const originalObj = {name: "old-service", version: "1.0.0"}
 * const modifiedObj = {name: "new-service", version: "1.1.0"}
 *
 * <DiffView
 *   language="yaml" // Objects will be converted to YAML
 *   original={originalObj}
 *   modified={modifiedObj}
 * />
 * ```
 *
 * ### 3. Mixed Input Types
 * You can even mix strings and objects:
 *
 * ```tsx
 * <DiffView
 *   language="json"
 *   original='{"name": "old"}' // String input
 *   modified={{name: "new", version: "2.0"}} // Object input
 * />
 * ```
 *
 * ## Internal Processing:
 * 1. Content is passed as strings to the DiffHighlightPlugin
 * 2. Plugin parses strings back to objects for consistent formatting
 * 3. Objects are re-serialized to target format (JSON/YAML) with proper indentation
 * 4. Line-by-line diff is computed and highlighted
 *
 * ## Language Switching:
 * When switching between JSON and YAML, ensure content is converted:
 *
 * ```tsx
 * const convertContent = (content: string, fromLang: string, toLang: string) => {
 *   if (fromLang === toLang) return content
 *
 *   try {
 *     if (fromLang === "json" && toLang === "yaml") {
 *       const parsed = JSON.parse(content)
 *       return yaml.dump(parsed, {indent: 2})
 *     } else if (fromLang === "yaml" && toLang === "json") {
 *       const parsed = yaml.load(content)
 *       return JSON.stringify(parsed, null, 2)
 *     }
 *   } catch (error) {
 *     console.warn(`Conversion failed:`, error)
 *     return toLang === "json" ? "{}" : ""
 *   }
 *   return content
 * }
 * ```
 *
 * ## Error Handling:
 * - Invalid JSON/YAML syntax shows error messages
 * - Parsing errors are caught and displayed to users
 * - Graceful fallback to empty content on conversion errors
 *
 * @example Basic Usage
 * ```tsx
 * <DiffView
 *   language="json"
 *   original='{"name": "old"}'
 *   modified='{"name": "new"}'
 *   className="h-96 border rounded"
 *   debounceMs={500}
 *   showErrors={true}
 * />
 * ```
 */

import React, {useState, useEffect} from "react"

import {getContentLanguage} from "@agenta/shared/utils"
import yaml from "js-yaml"

import EditorWrapper from "./Editor"
import DiffHighlightPlugin from "./plugins/code/plugins/DiffHighlightPlugin"

/**
 * Detect the language of a string content.
 * Uses shared utility and maps "text" to "json" for DiffView context.
 */
function detectLanguage(content: string): "json" | "yaml" {
    const detected = getContentLanguage(content)
    // DiffView only supports json/yaml, default to json for text
    return detected === "text" ? "json" : detected
}

/** Content type for DiffView - either a string or a JSON-serializable object */
type DiffContent = string | Record<string, unknown> | unknown[] | null

/**
 * Normalize content to string format
 */
function normalizeContent(content: DiffContent, targetLanguage: "json" | "yaml"): string {
    // If already a string, return as-is
    if (typeof content === "string") {
        return content
    }

    // Convert object to target format
    if (targetLanguage === "yaml") {
        return yaml.dump(content, {indent: 2})
    } else {
        return JSON.stringify(content, null, 2)
    }
}

/**
 * Convert content between formats when language changes
 */
function convertContent(
    content: string,
    fromLanguage: "json" | "yaml",
    toLanguage: "json" | "yaml",
): string {
    if (fromLanguage === toLanguage) {
        return content
    }

    try {
        if (fromLanguage === "json" && toLanguage === "yaml") {
            const parsed = JSON.parse(content)
            return yaml.dump(parsed, {indent: 2})
        } else if (fromLanguage === "yaml" && toLanguage === "json") {
            const parsed = yaml.load(content)
            return JSON.stringify(parsed, null, 2)
        }
    } catch (error) {
        console.warn(`Failed to convert content from ${fromLanguage} to ${toLanguage}:`, error)
        // Return empty content of target format on conversion error
        return toLanguage === "json" ? "{}" : ""
    }

    return content
}

/**
 * Reusable DiffView component that handles diff computation and display
 */
export interface DiffViewProps {
    /** Language for diff display - if not provided, will be inferred from content */
    language?: "json" | "yaml"
    /** Original content - can be string (JSON/YAML) or JavaScript object */
    original: DiffContent
    /** Modified content - can be string (JSON/YAML) or JavaScript object */
    modified: DiffContent
    /** Additional CSS classes */
    className?: string
    /** Debounce delay for diff computation in milliseconds */
    debounceMs?: number
    /** Whether to show error messages */
    showErrors?: boolean
    /** Enable folding of large unchanged sections */
    enableFolding?: boolean
    /** Minimum number of consecutive context lines before folding */
    foldThreshold?: number
    /** Show count of folded lines in fold indicators */
    showFoldedLineCount?: boolean
    /** If true, compute diff only once on mount and never debounce or recompute */
    computeOnMountOnly?: boolean
}

function computeProcessed(
    languageProp: DiffViewProps["language"],
    originalProp: DiffViewProps["original"],
    modifiedProp: DiffViewProps["modified"],
) {
    // Normalize content to strings
    const originalStr = normalizeContent(originalProp, languageProp || "json")
    const modifiedStr = normalizeContent(modifiedProp, languageProp || "json")

    // Determine final language
    let finalLanguage: "json" | "yaml"
    if (languageProp) {
        finalLanguage = languageProp
    } else {
        const originalLang = detectLanguage(originalStr)
        const modifiedLang = detectLanguage(modifiedStr)
        finalLanguage = originalLang === "yaml" || modifiedLang === "yaml" ? "yaml" : "json"
    }

    // Convert content to target language if needed
    let processedOriginal = originalStr
    let processedModified = modifiedStr

    if (typeof originalProp === "string" && languageProp) {
        const detectedOriginal = detectLanguage(originalStr)
        if (detectedOriginal !== finalLanguage) {
            processedOriginal = convertContent(originalStr, detectedOriginal, finalLanguage)
        }
    }

    if (typeof modifiedProp === "string" && languageProp) {
        const detectedModified = detectLanguage(modifiedStr)
        if (detectedModified !== finalLanguage) {
            processedModified = convertContent(modifiedStr, detectedModified, finalLanguage)
        }
    }

    return {
        original: processedOriginal,
        modified: processedModified,
        language: finalLanguage,
    }
}

const DiffView: React.FC<DiffViewProps> = ({
    language,
    original,
    modified,
    className = "",
    debounceMs = 300,
    showErrors = true,
    enableFolding = false,
    foldThreshold = 5,
    showFoldedLineCount = true,
    computeOnMountOnly = false,
}) => {
    const [diffKey, setDiffKey] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const [processedContent, setProcessedContent] = useState<{
        original: string
        modified: string
        language: "json" | "yaml"
    }>(() => computeProcessed(language, original, modified))

    // Process content and determine language
    useEffect(() => {
        if (computeOnMountOnly) return
        try {
            setError(null)
            const next = computeProcessed(language, original, modified)
            setProcessedContent(next)
        } catch (parseError) {
            if (showErrors) {
                setError(`Failed to process content. Please check your syntax.`)
            }
        }
    }, [
        original,
        modified,
        language,
        showErrors,
        enableFolding,
        foldThreshold,
        showFoldedLineCount,
        computeOnMountOnly,
    ])

    // Trigger diff computation with debouncing for content, immediate for folding
    useEffect(() => {
        if (computeOnMountOnly) return
        if (debounceMs && debounceMs > 0) {
            const timeout = setTimeout(() => {
                setDiffKey((prev) => prev + 1)
            }, debounceMs)
            return () => clearTimeout(timeout)
        }
        // No debounce: update immediately without timeouts
        setDiffKey((prev) => prev + 1)
    }, [processedContent, debounceMs, computeOnMountOnly])

    // Trigger immediate diff computation when folding options change
    useEffect(() => {
        if (computeOnMountOnly) return
        setDiffKey((prev) => prev + 1)
    }, [enableFolding, foldThreshold, showFoldedLineCount, computeOnMountOnly])

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
                language={processedContent.language}
                additionalCodePlugins={[
                    <DiffHighlightPlugin
                        key="diff-highlight"
                        originalContent={processedContent.original}
                        modifiedContent={processedContent.modified}
                        language={processedContent.language}
                        enableFolding={enableFolding}
                        foldThreshold={foldThreshold}
                        showFoldedLineCount={showFoldedLineCount}
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
