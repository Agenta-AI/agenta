import {memo, type ReactNode, useCallback, useEffect, useMemo, useState} from "react"

import {
    ArrowDownIcon,
    ArrowUpIcon,
    CaretDown,
    CaretRight,
    MagnifyingGlassIcon,
    XIcon,
} from "@phosphor-icons/react"
import {Button, Input, Select} from "antd"
import {useAtomValue} from "jotai"
import yaml from "js-yaml"

import CopyButton from "@/oss/components/CopyButton/CopyButton"
import EditorWrapper, {
    EditorProvider,
    useLexicalComposerContext,
} from "@/oss/components/Editor/Editor"
import {ON_CHANGE_LANGUAGE} from "@/oss/components/Editor/plugins/code"
import {SearchPlugin} from "@/oss/components/Editor/plugins/search/SearchPlugin"
import {traceSpan} from "@/oss/state/entities/trace"

import type {DrillInContentProps} from "./DrillInContent"
import {EntityDrillInView} from "./EntityDrillInView"

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
}

type RawSpanViewMode = "json" | "yaml"

const LanguageAwareViewer = ({
    initialValue,
    language,
    searchProps,
}: {
    initialValue: string
    language: RawSpanViewMode
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
        changeLanguage(language)
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

    return (
        <EditorWrapper
            initialValue={initialValue}
            language={language}
            codeOnly={true}
            showToolbar={false}
            enableTokens={false}
            disabled
            noProvider
            readOnly
            additionalCodePlugins={additionalPlugins}
        />
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
    }: TraceSpanDrillInViewProps) => {
        const spanData = useAtomValue(traceSpan.selectors.data(spanId))
        const [viewMode, setViewMode] = useState<RawSpanViewMode>("json")
        const [isCollapsed, setIsCollapsed] = useState(false)
        const [isSearchOpen, setIsSearchOpen] = useState(false)
        const [searchTerm, setSearchTerm] = useState("")
        const [currentResultIndex, setCurrentResultIndex] = useState(0)
        const [resultCount, setResultCount] = useState(0)

        const jsonOutput = useMemo(
            () => JSON.stringify(spanData ?? {}, null, 2) ?? "null",
            [spanData],
        )
        const yamlOutput = useMemo(() => {
            try {
                return yaml.dump(spanData ?? {}, {lineWidth: 120})
            } catch {
                return ""
            }
        }, [spanData])

        const activeOutput = viewMode === "yaml" ? yamlOutput : jsonOutput

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
            setIsCollapsed((prev) => {
                const next = !prev
                if (next) closeSearch()
                return next
            })
        }, [closeSearch])

        useEffect(() => {
            closeSearch()
        }, [activeOutput, closeSearch])

        if (rootScope === "span") {
            return (
                <div className="rounded-md overflow-hidden bg-white">
                    <div
                        className="drill-in-field-header rounded-md flex items-center justify-between py-2 px-3 bg-[#FAFAFA] border border-solid border-[rgba(5,23,41,0.06)] cursor-pointer"
                        onClick={toggleCollapsed}
                    >
                        <div className="flex items-center gap-2 text-gray-700 font-medium">
                            {isCollapsed ? <CaretRight size={14} /> : <CaretDown size={14} />}
                            <span>{title}</span>
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
                            />
                            <Select
                                size="small"
                                value={viewMode}
                                options={[
                                    {label: "JSON", value: "json"},
                                    {label: "YAML", value: "yaml"},
                                ]}
                                onChange={(value) => setViewMode(value as RawSpanViewMode)}
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
                    {!isCollapsed && (
                        <div className="relative">
                            {isSearchOpen && (
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
                        </div>
                    )}
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
