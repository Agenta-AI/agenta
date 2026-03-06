import {
    memo,
    type ReactNode,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useState,
} from "react"

import {
    Editor as EditorWrapper,
    EditorProvider,
    DrillInProvider,
    useLexicalComposerContext,
    ON_CHANGE_LANGUAGE,
    SET_MARKDOWN_VIEW,
    SearchPlugin,
} from "@agenta/ui"
import {
    ArrowDownIcon,
    ArrowUpIcon,
    CaretDown,
    CaretRight,
    CopyIcon,
    DownloadIcon,
    FileTextIcon,
    MagnifyingGlassIcon,
    XIcon,
} from "@phosphor-icons/react"
import {Button, Input, Select} from "antd"
import {useAtomValue} from "jotai"
import yaml from "js-yaml"
import JSON5 from "json5"
import dynamic from "next/dynamic"

import CopyButton from "@/oss/components/CopyButton/CopyButton"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {getStringOrJson, sanitizeDataWithBlobUrls} from "@/oss/lib/helpers/utils"
import {traceSpan} from "@/oss/state/entities/trace"

import type {DrillInContentProps} from "./DrillInContent"
import {EntityDrillInView} from "./EntityDrillInView"
const ImagePreview = dynamic(() => import("@agenta/ui").then((mod) => mod.ImagePreview), {
    ssr: false,
})

// ============================================================================
// TYPES
// ============================================================================

export interface TraceSpanDrillInViewProps extends Omit<
    DrillInContentProps,
    "getValue" | "setValue" | "getRootItems" | "valueMode"
> {
    /** The span ID to display */
    spanId: string
    /** Optional title for the root level */
    title?: string
    /** Optional prefix element for breadcrumb (e.g., span navigation) */
    breadcrumbPrefix?: ReactNode
    /** Whether to show the back arrow in breadcrumb (default: true) */
    showBackArrow?: boolean
    /** Whether editing is enabled (default: false for traces) */
    editable?: boolean
    /** Column options for mapping dropdown */
    columnOptions?: {value: string; label: string}[]
    /** Callback when user wants to map a field to a column */
    onMapToColumn?: (dataPath: string, column: string) => void
    /** Callback when user wants to remove a mapping */
    onUnmap?: (dataPath: string) => void
    /** Map of data paths to column names (for visual indication) */
    mappedPaths?: Map<string, string>
    /** Path to focus/navigate to (e.g., "data.inputs.prompt") */
    focusPath?: string
    /** Callback when focusPath has been handled */
    onFocusPathHandled?: () => void
    /** Callback when a JSON property key is Cmd/Meta+clicked */
    onPropertyClick?: (path: string) => void
    /** Initial path to start navigation at */
    initialPath?: string | string[]
    /** Hide breadcrumb row (useful when parent already handles navigation layout) */
    hideBreadcrumb?: boolean
    /** Enables drill-in action button in field headers (default: true) */
    showFieldDrillIn?: boolean
    /** Enables explicit view mode selector for field content (JSON/YAML/Text/Markdown) */
    enableFieldViewModes?: boolean
    /** Root scope to render: span attributes (default) or full span payload */
    rootScope?: "attributes" | "span"
    /** View-mode preset for span content rendering */
    viewModePreset?: "default" | "message"
    /** Controls collapse behavior for rootScope="span" */
    allowSpanCollapse?: boolean
    /** Optional override data for rootScope="span" rendering */
    spanDataOverride?: unknown
}

type RawSpanViewMode = "json" | "yaml"

type RawSpanDisplayMode = RawSpanViewMode | "rendered-json" | "text" | "markdown"

const RAW_SPAN_VIEW_MODE_LABELS: Record<RawSpanDisplayMode, string> = {
    json: "JSON",
    yaml: "YAML",
    "rendered-json": "Rendered JSON",
    text: "Text",
    markdown: "Markdown",
}

const getDefaultRawSpanViewMode = (availableModes: RawSpanDisplayMode[]): RawSpanDisplayMode => {
    if (availableModes.includes("rendered-json")) return "rendered-json"
    return availableModes[0] ?? "json"
}

const normalizeEscapedLineBreaks = (value: string): string =>
    value.replaceAll("\\r\\n", "\n").replaceAll("\\n", "\n")

const parseStructuredJson = (value: string): unknown | null => {
    const tryParseJson = (input: string): unknown | null => {
        try {
            return JSON.parse(input)
        } catch {
            return null
        }
    }

    const toStructured = (parsed: unknown): unknown | null => {
        if (parsed && typeof parsed === "object") return parsed
        if (typeof parsed !== "string") return null

        const nested = tryParseJson(parsed.trim())
        if (nested && typeof nested === "object") return nested
        return null
    }

    let candidate = value.trim()
    if (!candidate) return null

    const fencedMatch = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    if (fencedMatch?.[1]) {
        candidate = fencedMatch[1].trim()
    }

    const strictParsed = toStructured(tryParseJson(candidate))
    if (strictParsed !== null) return strictParsed

    try {
        return toStructured(JSON5.parse(candidate))
    } catch {
        return null
    }
}

const renderStringifiedJson = (value: unknown): {value: unknown; didRender: boolean} => {
    if (typeof value === "string") {
        const parsed = parseStructuredJson(value)
        if (parsed === null) return {value, didRender: false}
        const nested = renderStringifiedJson(parsed)
        return {value: nested.value, didRender: true}
    }

    if (Array.isArray(value)) {
        let didRender = false
        const rendered = value.map((item) => {
            const next = renderStringifiedJson(item)
            if (next.didRender) didRender = true
            return next.value
        })
        return {value: rendered, didRender}
    }

    if (value && typeof value === "object") {
        let didRender = false
        const rendered = Object.fromEntries(
            Object.entries(value).map(([key, nestedValue]) => {
                const next = renderStringifiedJson(nestedValue)
                if (next.didRender) didRender = true
                return [key, next.value]
            }),
        )
        return {value: rendered, didRender}
    }

    return {value, didRender: false}
}

const decodeEscapedLineBreaks = (value: string): string => {
    let decoded = value

    // Handle both "\n" and "\\n" style payload encodings.
    for (let i = 0; i < 2; i += 1) {
        const next = decoded
            .replace(/\\\\r\\\\n/g, "\r\n")
            .replace(/\\\\n/g, "\n")
            .replace(/\\r\\n/g, "\r\n")
            .replace(/\\n/g, "\n")

        if (next === decoded) break
        decoded = next
    }

    return decoded
}

const formatRenderedJsonStringsForDisplay = (value: unknown): unknown => {
    if (typeof value === "string") {
        // Decode escaped line breaks and preserve multiline rendering in JSON code view.
        return decodeEscapedLineBreaks(value).replace(/\r\n|\n|\r/g, "\u2028")
    }

    if (Array.isArray(value)) {
        return value.map((item) => formatRenderedJsonStringsForDisplay(item))
    }

    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, nestedValue]) => [
                key,
                formatRenderedJsonStringsForDisplay(nestedValue),
            ]),
        )
    }

    return value
}

const LanguageAwareViewer = ({
    initialValue,
    language,
    searchProps,
}: {
    initialValue: string
    language: RawSpanDisplayMode
    searchProps?: {
        searchTerm: string
        currentResultIndex: number
        onResultCountChange: (count: number) => void
    }
}) => {
    const [editor] = useLexicalComposerContext()
    const changeLanguage = useCallback(
        (lang: RawSpanViewMode) => {
            editor.dispatchCommand(ON_CHANGE_LANGUAGE, {language: lang})
        },
        [editor],
    )

    useEffect(() => {
        changeLanguage(language === "yaml" ? "yaml" : "json")
        editor.setEditable(false)
    }, [changeLanguage, editor, language])

    const additionalPlugins = useMemo(() => {
        if (!searchProps) return []
        return [
            <SearchPlugin
                key="search"
                searchTerm={searchProps.searchTerm}
                currentResultIndex={searchProps.currentResultIndex}
                onResultCountChange={searchProps.onResultCountChange}
            />,
        ]
    }, [searchProps])

    const editorNode = (
        <EditorWrapper
            initialValue={initialValue}
            language={language === "yaml" ? "yaml" : "json"}
            codeOnly={true}
            showToolbar={false}
            enableTokens={false}
            disabled
            noProvider
            readOnly
            additionalCodePlugins={additionalPlugins}
        />
    )

    return editorNode
}

const MarkdownModeSync = ({isMarkdownView}: {isMarkdownView: boolean}) => {
    const [editor] = useLexicalComposerContext()

    useLayoutEffect(() => {
        editor.dispatchCommand(SET_MARKDOWN_VIEW, isMarkdownView)
    }, [editor, isMarkdownView])

    useEffect(() => {
        const frameId = requestAnimationFrame(() => {
            editor.dispatchCommand(SET_MARKDOWN_VIEW, isMarkdownView)
        })
        return () => cancelAnimationFrame(frameId)
    }, [editor, isMarkdownView])

    return null
}

const TextModeViewer = ({
    editorId,
    value,
    mode,
}: {
    editorId: string
    value: string
    mode: "text" | "markdown"
}) => {
    return (
        <EditorProvider
            id={editorId}
            initialValue={value}
            showToolbar={false}
            enableTokens={false}
            readOnly
            className="[&_.editor-inner]:!border-0 [&_.editor-inner]:!rounded-none [&_.editor-container]:!bg-transparent [&_.editor-input]:!min-h-0 [&_.editor-input]:!px-4 [&_.editor-input]:!py-[6px] [&_.editor-paragraph]:!mb-1 [&_.editor-paragraph:last-child]:!mb-0 [&_.editor-input.markdown-view_.editor-code]:!m-0 [&_.editor-input.markdown-view_.editor-code]:!p-0 [&_.editor-input.markdown-view_.editor-code]:!bg-transparent"
        >
            <MarkdownModeSync isMarkdownView={mode === "text"} />
            <EditorWrapper
                initialValue={value}
                disabled
                codeOnly={false}
                showToolbar={false}
                boundHeight={false}
                noProvider
                readOnly
            />
        </EditorProvider>
    )
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Drill-in viewer for trace span data.
 *
 * Uses the unified traceSpan entity API for all state management.
 * This is a thin wrapper that passes the trace controller to EntityDrillInView.
 *
 * Default behavior for traces:
 * - Read-only (editable=false)
 * - No add/delete controls
 * - Root title is "data"
 *
 * @example
 * ```tsx
 * // Read-only trace viewing with column mapping
 * <TraceSpanDrillInView
 *   spanId={spanId}
 *   columnOptions={columnOptions}
 *   onMapToColumn={handleMap}
 *   mappedPaths={mappedPaths}
 * />
 *
 * // Editable trace
 * <TraceSpanDrillInView
 *   spanId={spanId}
 *   editable={true}
 * />
 * ```
 */
export const TraceSpanDrillInView = memo(
    ({
        spanId,
        title = "data",
        breadcrumbPrefix,
        showBackArrow = true,
        editable = false,
        columnOptions,
        onMapToColumn,
        onUnmap,
        mappedPaths,
        focusPath,
        onFocusPathHandled,
        onPropertyClick,
        initialPath,
        hideBreadcrumb,
        showFieldDrillIn,
        enableFieldViewModes,
        hideSingleFieldHeader,
        hideFieldHeaders,
        showFieldCollapse,
        rootScope = "attributes",
        viewModePreset = "default",
        allowSpanCollapse = true,
        spanDataOverride,
    }: TraceSpanDrillInViewProps) => {
        const spanEntityData = useAtomValue(traceSpan.selectors.data(spanId))
        const spanData = spanDataOverride !== undefined ? spanDataOverride : spanEntityData
        const textViewerId = useId().replace(/:/g, "")

        const {
            data: sanitizedSpanData,
            fileAttachments,
            imageAttachments,
        } = useMemo(() => sanitizeDataWithBlobUrls(spanData), [spanData])

        const [isCollapsed, setIsCollapsed] = useState(false)
        const [isSearchOpen, setIsSearchOpen] = useState(false)
        const [searchTerm, setSearchTerm] = useState("")
        const [currentResultIndex, setCurrentResultIndex] = useState(0)
        const [resultCount, setResultCount] = useState(0)

        const isStringValue = typeof sanitizedSpanData === "string"
        const isObjectOrArrayValue =
            sanitizedSpanData !== null && typeof sanitizedSpanData === "object"
        const parsedStructuredString = useMemo(
            () => (isStringValue ? parseStructuredJson(sanitizedSpanData) : null),
            [isStringValue, sanitizedSpanData],
        )

        const renderedJsonSource = useMemo(() => {
            if (isStringValue) {
                return parsedStructuredString ?? sanitizedSpanData
            }
            return sanitizedSpanData
        }, [isStringValue, parsedStructuredString, sanitizedSpanData])

        const jsonOutput = useMemo(
            () =>
                isStringValue
                    ? parsedStructuredString !== null
                        ? sanitizedSpanData
                        : (JSON.stringify(sanitizedSpanData) ?? "")
                    : getStringOrJson(sanitizedSpanData),
            [isStringValue, parsedStructuredString, sanitizedSpanData],
        )
        const renderedJsonResult = useMemo(
            () => renderStringifiedJson(renderedJsonSource ?? {}),
            [renderedJsonSource],
        )
        const renderedJsonOutput = useMemo(
            () =>
                JSON.stringify(
                    formatRenderedJsonStringsForDisplay(renderedJsonResult.value),
                    null,
                    2,
                ) ?? "null",
            [renderedJsonResult.value],
        )
        const yamlOutput = useMemo(() => {
            const yamlSource = isStringValue ? parsedStructuredString : sanitizedSpanData
            if (yamlSource === null || yamlSource === undefined) return ""
            try {
                return yaml.dump(yamlSource, {lineWidth: 120})
            } catch {
                return ""
            }
        }, [isStringValue, parsedStructuredString, sanitizedSpanData])

        const textOutput = useMemo(() => {
            if (typeof sanitizedSpanData === "string") {
                return parsedStructuredString !== null
                    ? normalizeEscapedLineBreaks(sanitizedSpanData)
                    : sanitizedSpanData
            }
            return getStringOrJson(sanitizedSpanData)
        }, [parsedStructuredString, sanitizedSpanData])

        const availableViewModes = useMemo(() => {
            if (viewModePreset === "message") {
                const modes: RawSpanDisplayMode[] = ["text", "markdown"]
                if (
                    (isStringValue && parsedStructuredString !== null) ||
                    (!isStringValue && isObjectOrArrayValue)
                ) {
                    modes.push("rendered-json")
                }
                return modes
            }

            if (isStringValue) {
                if (parsedStructuredString !== null) {
                    const modes: RawSpanDisplayMode[] = ["json", "yaml", "rendered-json"]
                    modes.push("text", "markdown")
                    return modes
                }
                return ["text", "markdown"] as RawSpanDisplayMode[]
            }

            const modes: RawSpanDisplayMode[] = ["json", "yaml", "rendered-json"]
            return modes
        }, [viewModePreset, isStringValue, isObjectOrArrayValue, parsedStructuredString])
        const [viewMode, setViewMode] = useState<RawSpanDisplayMode>(() =>
            getDefaultRawSpanViewMode(availableViewModes),
        )

        const isCodeMode =
            viewMode === "json" || viewMode === "yaml" || viewMode === "rendered-json"

        const activeOutput =
            viewMode === "yaml"
                ? yamlOutput
                : viewMode === "rendered-json"
                  ? renderedJsonOutput
                  : viewMode === "json"
                    ? jsonOutput
                    : textOutput

        const closeSearch = useCallback(() => {
            setIsSearchOpen(false)
            setSearchTerm("")
            setResultCount(0)
            setCurrentResultIndex(0)
        }, [])

        const handleNextMatch = useCallback(() => {
            if (resultCount === 0) return
            setCurrentResultIndex((prev) => (prev + 1) % resultCount)
        }, [resultCount])

        const handlePrevMatch = useCallback(() => {
            if (resultCount === 0) return
            setCurrentResultIndex((prev) => (prev - 1 + resultCount) % resultCount)
        }, [resultCount])

        const toggleCollapsed = useCallback(() => {
            if (!allowSpanCollapse) return
            setIsCollapsed((prev) => {
                const next = !prev
                if (next) closeSearch()
                return next
            })
        }, [allowSpanCollapse, closeSearch])

        useEffect(() => {
            if (!availableViewModes.includes(viewMode)) {
                setViewMode(getDefaultRawSpanViewMode(availableViewModes))
            }
        }, [availableViewModes, viewMode])

        useEffect(() => {
            closeSearch()
        }, [activeOutput, closeSearch])

        useEffect(() => {
            if (!isCodeMode) {
                closeSearch()
            }
        }, [isCodeMode, closeSearch])

        const downloadFile = useCallback((url: string) => {
            const link = document.createElement("a")
            link.href = url
            link.download = ""
            link.click()
        }, [])
        const hasAttachments = Boolean(
            (fileAttachments?.length ?? 0) + (imageAttachments?.length ?? 0),
        )

        if (rootScope === "span") {
            const showTitle = Boolean(title)
            return (
                <div className="rounded-md overflow-hidden bg-white">
                    <div
                        className={`drill-in-field-header rounded-md flex items-center justify-between py-2 px-3 bg-white border border-solid border-[rgba(5,23,41,0.06)] ${allowSpanCollapse ? "cursor-pointer" : ""}`}
                        onClick={allowSpanCollapse ? toggleCollapsed : undefined}
                    >
                        <div className="flex items-center gap-2 text-gray-700 font-medium min-h-[16px]">
                            {allowSpanCollapse &&
                                (isCollapsed ? <CaretRight size={14} /> : <CaretDown size={14} />)}
                            {showTitle ? <span>{title}</span> : null}
                        </div>
                        <div
                            className="flex items-center gap-2"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <Button
                                size="small"
                                type={isSearchOpen ? "primary" : "text"}
                                className={`${isSearchOpen ? "!bg-[#17324D] !border-[#17324D]" : "text-gray-500"} !px-1 !h-6 text-xs`}
                                icon={<MagnifyingGlassIcon size={14} />}
                                onClick={() => setIsSearchOpen((prev) => !prev)}
                                disabled={!isCodeMode}
                            />
                            <Select
                                size="small"
                                value={viewMode}
                                options={availableViewModes.map((mode) => ({
                                    label: RAW_SPAN_VIEW_MODE_LABELS[mode],
                                    value: mode,
                                }))}
                                onChange={(value) => setViewMode(value as RawSpanDisplayMode)}
                                className="min-w-[126px]"
                                popupMatchSelectWidth={false}
                            />
                            <CopyButton
                                text={activeOutput}
                                icon={true}
                                buttonText={null}
                                stopPropagation
                                size="small"
                            />
                        </div>
                    </div>
                    {(!allowSpanCollapse || !isCollapsed) && (
                        <div className="relative">
                            {isSearchOpen && isCodeMode && (
                                <div className="absolute right-4 top-3 z-20 flex items-center gap-2 rounded-xl border border-[rgba(5,23,41,0.14)] bg-white px-2 py-2 shadow-[0_8px_24px_rgba(5,23,41,0.12)]">
                                    <Input
                                        size="small"
                                        className="w-[180px]"
                                        placeholder="Search..."
                                        value={searchTerm}
                                        onChange={(e) => {
                                            setSearchTerm(e.target.value)
                                            setCurrentResultIndex(0)
                                        }}
                                        onPressEnter={handleNextMatch}
                                        autoFocus
                                    />
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={<ArrowUpIcon size={14} />}
                                        onClick={handlePrevMatch}
                                        disabled={resultCount === 0}
                                    />
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={<ArrowDownIcon size={14} />}
                                        onClick={handleNextMatch}
                                        disabled={resultCount === 0}
                                    />
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={<XIcon size={14} />}
                                        onClick={closeSearch}
                                    />
                                </div>
                            )}
                            {isCodeMode ? (
                                <DrillInProvider
                                    value={{
                                        enabled: false,
                                        decodeEscapedJsonStrings: viewMode === "rendered-json",
                                    }}
                                >
                                    <EditorProvider
                                        codeOnly
                                        enableTokens={false}
                                        showToolbar={false}
                                        readOnly
                                        disabled
                                        noProvider
                                    >
                                        <LanguageAwareViewer
                                            initialValue={activeOutput}
                                            language={viewMode}
                                            searchProps={
                                                isSearchOpen
                                                    ? {
                                                          searchTerm,
                                                          currentResultIndex,
                                                          onResultCountChange: setResultCount,
                                                      }
                                                    : undefined
                                            }
                                        />
                                    </EditorProvider>
                                </DrillInProvider>
                            ) : (
                                <div className="mx-1 my-2 rounded-md bg-[#F6F8FB]">
                                    <TextModeViewer
                                        editorId={`trace-span-${textViewerId}`}
                                        value={textOutput}
                                        mode={viewMode as "text" | "markdown"}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                    {(!allowSpanCollapse || !isCollapsed) && hasAttachments ? (
                        <div className="flex flex-col gap-2 mt-4">
                            <span className="tracking-wide">Attachments</span>
                            <div className="flex flex-wrap gap-2">
                                {(fileAttachments || [])?.map((file, index) => (
                                    <a
                                        key={`${file.data}-${index}`}
                                        className="group w-[80px] h-[60px] rounded border border-solid border-gray-200 bg-gray-100 px-2 pt-3 pb-2 hover:bg-gray-200 hover:scale-[1.02] cursor-pointer flex flex-col justify-between"
                                        href={file.data}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        <div className="w-full flex items-start gap-1">
                                            <FileTextIcon size={16} className="shrink-0" />
                                            <span className="text-[10px] truncate">
                                                {file.filename || `File ${index + 1}`}
                                            </span>
                                        </div>
                                        <div className="flex gap-1.5 shrink-0 invisible group-hover:visible">
                                            <Button
                                                type="text"
                                                size="small"
                                                icon={<DownloadIcon size={10} />}
                                                className="!w-5 !h-5"
                                                onClick={(e) => {
                                                    e.preventDefault()
                                                    downloadFile(file.data)
                                                }}
                                            />
                                            <Button
                                                type="text"
                                                size="small"
                                                icon={<CopyIcon size={10} />}
                                                className="!w-5 !h-5"
                                                onClick={(e) => {
                                                    e.preventDefault()
                                                    copyToClipboard(file.data)
                                                }}
                                            />
                                        </div>
                                    </a>
                                ))}

                                {(imageAttachments || [])?.map((image, index) => (
                                    <ImagePreview
                                        key={`${image.data}-${index}`}
                                        src={image.data}
                                        isValidPreview={true}
                                        alt={image.filename || `Image ${index + 1}`}
                                        size={80}
                                        className=""
                                    />
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
            )
        }

        // Type assertion needed because traceSpan.drillIn is optional in the general type
        // but we know it's configured for the trace entity
        const entityWithDrillIn = traceSpan as typeof traceSpan & {
            drillIn: NonNullable<typeof traceSpan.drillIn>
        }

        return (
            <EntityDrillInView
                entityId={spanId}
                entity={entityWithDrillIn}
                // Trace-specific defaults
                rootTitle={title}
                editable={editable}
                showAddControls={false}
                showDeleteControls={false}
                // Navigation props
                breadcrumbPrefix={breadcrumbPrefix}
                showBackArrow={showBackArrow}
                initialPath={initialPath}
                focusPath={focusPath}
                onFocusPathHandled={onFocusPathHandled}
                onPropertyClick={onPropertyClick}
                // Column mapping props (for AddToTestsetDrawer integration)
                columnOptions={columnOptions}
                onMapToColumn={onMapToColumn}
                onUnmap={onUnmap}
                mappedPaths={mappedPaths}
                // Display control props
                hideBreadcrumb={hideBreadcrumb}
                showFieldDrillIn={showFieldDrillIn}
                enableFieldViewModes={enableFieldViewModes}
                hideSingleFieldHeader={hideSingleFieldHeader}
                hideFieldHeaders={hideFieldHeaders}
                showFieldCollapse={showFieldCollapse}
            />
        )
    },
)

TraceSpanDrillInView.displayName = "TraceSpanDrillInView"
