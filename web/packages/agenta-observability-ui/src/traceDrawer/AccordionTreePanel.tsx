import {useCallback, useEffect, useLayoutEffect, useId, useMemo, useRef, useState} from "react"

import {sanitizeDataWithBlobUrls} from "@agenta/shared/utils"
import {getStringOrJson} from "@agenta/shared/utils"
import {CopyButton, EnhancedButton} from "@agenta/ui/components/presentational"
import {
    Editor as EditorWrapper,
    EditorProvider,
    DrillInProvider,
    useLexicalComposerContext,
    ON_CHANGE_LANGUAGE,
    SET_MARKDOWN_VIEW,
    SearchPlugin,
} from "@agenta/ui/editor"
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    Input,
    Segmented,
} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {
    ArrowDownIcon,
    ArrowUpIcon,
    CaretUpDown,
    CopyIcon,
    DownloadIcon,
    FileTextIcon,
    MagnifyingGlassIcon,
    XIcon,
} from "@phosphor-icons/react"
import yaml from "js-yaml"
import dynamic from "next/dynamic"

import {
    buildDecodedJsonOutput,
    normalizeEscapedLineBreaks,
    parseStructuredJson,
} from "../drillIn/decodedJsonHelpers"
import {getDefaultJsonViewMode} from "../drillIn/viewModes"

import {getTraceDrawerReferences} from "./referenceSlots"

const ImagePreview = dynamic(
    () =>
        import("@agenta/ui/components/presentational").then((mod) => ({
            default: mod.ImagePreview,
        })),
    {ssr: false},
)

type AccordionTreePanelProps = {
    value: Record<string, unknown> | string | unknown[]
    label: string
    enableFormatSwitcher?: boolean
    bgColor?: string
    fullEditorHeight?: boolean
    enableSearch?: boolean
    viewModePreset?: "default" | "message"
    defaultCollapsed?: boolean
} & React.HTMLAttributes<HTMLDivElement>

/**
 * View modes for an accordion panel.
 *
 * See `VIEW_MODES.md` under `components/DrillInView/` for the full definition
 * of each mode — which display target it uses, what cleanup it applies, and
 * when it is the default. Keep this union in sync with `RawSpanDisplayMode`
 * in `TraceSpanDrillInView.tsx`.
 *
 * Summary:
 * - `json` / `yaml`: faithful — data as stored, no cleanup.
 * - `decoded-json`: JSON editor, cleaned (unwrap nested stringified JSON,
 *   decode escaped newlines).
 * - `pretty-json`: custom component tree (chat bubbles, per-key fields,
 *   envelope unwrap, noise stripping). Default for structured JSON data.
 * - `text` / `markdown`: prose editor.
 */
type PanelViewMode = "json" | "yaml" | "decoded-json" | "pretty-json" | "text" | "markdown"

const PANEL_VIEW_MODE_LABELS: Record<PanelViewMode, string> = {
    json: "JSON",
    yaml: "YAML",
    "decoded-json": "Decoded JSON",
    "pretty-json": "Pretty JSON",
    text: "Text",
    markdown: "Markdown",
}

// The JSS block these replace targeted `.ant-collapse-*` internals. This renders its own
// accordion markup, so the same rules apply directly — measurements unchanged (42px header,
// 1px borders on colorBorder, the panel filling the remaining height).
const collapseContainerClass =
    "bg-[unset] flex flex-col relative [&>div]:flex [&>div]:flex-col [&>div]:h-full [&>div]:bg-colorFillAlter [&>div]:rounded-control-lg [&>div]:border [&>div]:border-solid [&>div]:border-colorBorder [&>div]:overflow-y-auto"

const collapseHeaderClass = "items-center h-[42px] bg-colorBgContainer"

const collapsePanelClass =
    "border-t border-solid border-colorBorder p-0 leading-normal text-field-md grow rounded-b-control [&_.agenta-editor-wrapper]:bg-[inherit]"

const searchBarClass =
    "absolute top-12 right-6 z-[100] bg-colorBgContainer rounded-md shadow-lg flex items-center p-1 gap-1 border border-solid border-colorBorder"

const LanguageAwareViewer = ({
    initialValue,
    language,
    searchProps,
}: {
    initialValue: string
    language: "json" | "yaml" | "decoded-json"
    searchProps?: {
        searchTerm: string
        currentResultIndex: number
        onResultCountChange: (count: number) => void
    }
}) => {
    const [editor] = useLexicalComposerContext()
    const changeLanguage = useCallback(
        (lang: "json" | "yaml") => {
            editor.dispatchCommand(ON_CHANGE_LANGUAGE, {language: lang})
        },
        [editor],
    )

    useEffect(() => {
        if (language === "json" || language === "decoded-json") {
            changeLanguage("json")
        } else {
            changeLanguage("yaml")
        }
        editor.setEditable(false)
    }, [language, changeLanguage, editor])

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
            language={language === "decoded-json" ? "json" : language}
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

const AccordionTreePanel = ({
    value: incomingValue,
    label,
    enableFormatSwitcher = false,
    bgColor,
    fullEditorHeight = false,
    enableSearch = false,
    viewModePreset = "default",
    defaultCollapsed = false,
    ...props
}: AccordionTreePanelProps) => {
    const {PrettyJsonView: PrettyJsonViewSlot} = getTraceDrawerReferences()
    const editorRef = useRef<HTMLDivElement>(null)
    const textViewerId = useId().replace(/:/g, "")

    // Search State
    const [isSearchOpen, setIsSearchOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [currentResultIndex, setCurrentResultIndex] = useState(0)
    const [resultCount, setResultCount] = useState(0)

    const handleNextMatch = () => {
        if (resultCount === 0) return
        setCurrentResultIndex((prev) => (prev + 1) % resultCount)
    }

    const handlePrevMatch = () => {
        if (resultCount === 0) return
        setCurrentResultIndex((prev) => (prev - 1 + resultCount) % resultCount)
    }

    const closeSearch = useCallback(() => {
        setIsSearchOpen(false)
        setSearchTerm("")
        setResultCount(0)
        setCurrentResultIndex(0)
    }, [])

    const {
        data: sanitizedValue,
        fileAttachments,
        imageAttachments,
    } = useMemo(() => {
        return sanitizeDataWithBlobUrls(incomingValue)
    }, [incomingValue])

    const isStringValue = typeof sanitizedValue === "string"
    const isObjectOrArrayValue = sanitizedValue !== null && typeof sanitizedValue === "object"
    const parsedStructuredString = useMemo(
        () => (isStringValue ? parseStructuredJson(sanitizedValue) : null),
        [isStringValue, sanitizedValue],
    )

    const hasStructuredValue =
        (isStringValue && parsedStructuredString !== null) ||
        (!isStringValue && isObjectOrArrayValue)

    const availableViewModes = useMemo<PanelViewMode[]>(() => {
        if (viewModePreset === "message") {
            const modes: PanelViewMode[] = ["text", "markdown"]
            if (hasStructuredValue) {
                modes.push("decoded-json", "pretty-json")
            }
            return modes
        }

        if (isStringValue) {
            if (parsedStructuredString !== null) {
                return ["json", "yaml", "decoded-json", "pretty-json", "text", "markdown"]
            }
            return ["text", "markdown"]
        }

        return ["json", "yaml", "decoded-json", "pretty-json"]
    }, [viewModePreset, isStringValue, hasStructuredValue, parsedStructuredString])
    const [panelViewMode, setPanelViewMode] = useState<PanelViewMode>(() =>
        getDefaultJsonViewMode(availableViewModes),
    )

    useEffect(() => {
        if (!availableViewModes.includes(panelViewMode)) {
            setPanelViewMode(getDefaultJsonViewMode(availableViewModes))
        }
    }, [availableViewModes, panelViewMode])

    const isCodeMode =
        panelViewMode === "json" || panelViewMode === "yaml" || panelViewMode === "decoded-json"
    const isPrettyMode = panelViewMode === "pretty-json"

    useEffect(() => {
        if (!isCodeMode) {
            closeSearch()
        }
    }, [isCodeMode, closeSearch])

    useEffect(() => {
        closeSearch()
    }, [sanitizedValue, closeSearch])

    const downloadFile = useCallback((url: string) => {
        const link = document.createElement("a")
        link.href = url
        link.download = ""
        link.click()
    }, [])

    const jsonOutput = useMemo(() => {
        if (panelViewMode !== "json") return ""

        if (isStringValue) {
            if (parsedStructuredString !== null) {
                return sanitizedValue
            }
            return JSON.stringify(sanitizedValue) ?? ""
        }

        return getStringOrJson(sanitizedValue)
    }, [panelViewMode, isStringValue, parsedStructuredString, sanitizedValue])

    const yamlOutput = useMemo(() => {
        if (panelViewMode !== "yaml") return ""

        const yamlSource = isStringValue ? parsedStructuredString : sanitizedValue
        if (yamlSource === null || yamlSource === undefined) return ""

        try {
            return yaml.dump(yamlSource, {lineWidth: 120})
        } catch (error: unknown) {
            console.error("Failed to convert value to YAML:", error)
            return `Error: Failed to convert content to YAML. (${
                (error as Error | undefined)?.message || "Unknown error"
            })`
        }
    }, [panelViewMode, isStringValue, parsedStructuredString, sanitizedValue])

    const decodedJsonOutput = useMemo(() => {
        if (panelViewMode !== "decoded-json") return ""
        return buildDecodedJsonOutput(sanitizedValue, parsedStructuredString)
    }, [panelViewMode, sanitizedValue, parsedStructuredString])

    const prettyJsonSource = useMemo(() => {
        if (isStringValue) {
            return parsedStructuredString ?? sanitizedValue
        }
        return sanitizedValue
    }, [isStringValue, parsedStructuredString, sanitizedValue])

    const textOutput = useMemo(() => {
        if (typeof sanitizedValue === "string") {
            return parsedStructuredString !== null
                ? normalizeEscapedLineBreaks(sanitizedValue)
                : sanitizedValue
        }
        return getStringOrJson(sanitizedValue)
    }, [parsedStructuredString, sanitizedValue])

    const viewModeMenuItems = useMemo(
        () =>
            availableViewModes.map((mode) => ({
                key: mode,
                label: PANEL_VIEW_MODE_LABELS[mode],
                onClick: () => setPanelViewMode(mode),
            })),
        [availableViewModes],
    )

    const copyText =
        panelViewMode === "yaml"
            ? yamlOutput
            : panelViewMode === "decoded-json"
              ? decodedJsonOutput
              : panelViewMode === "json"
                ? jsonOutput
                : panelViewMode === "pretty-json"
                  ? JSON.stringify(prettyJsonSource, null, 2)
                  : textOutput

    const collapse = (
        <div className="relative">
            {isSearchOpen && (
                <div className={searchBarClass}>
                    <Input
                        placeholder="Search..."
                        value={searchTerm}
                        onChange={(e) => {
                            setSearchTerm(e.target.value)
                            setCurrentResultIndex(0)
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleNextMatch()
                        }}
                        autoFocus
                        className="w-[150px]"
                    />
                    {/* antd rendered this inside the input's `suffix` slot. */}
                    {resultCount > 0 ? (
                        <span className="text-xs text-gray-400">
                            {currentResultIndex + 1}/{resultCount}
                        </span>
                    ) : null}
                    <EnhancedButton
                        size="small"
                        type="text"
                        icon={<ArrowUpIcon size={14} />}
                        onClick={handlePrevMatch}
                        disabled={resultCount === 0}
                    />
                    <EnhancedButton
                        size="small"
                        type="text"
                        icon={<ArrowDownIcon size={14} />}
                        onClick={handleNextMatch}
                        disabled={resultCount === 0}
                    />
                    <EnhancedButton
                        size="small"
                        type="text"
                        icon={<XIcon size={14} />}
                        onClick={closeSearch}
                    />
                </div>
            )}
            <Accordion
                type="multiple"
                defaultValue={defaultCollapsed ? [] : [label]}
                className={collapseContainerClass}
            >
                <AccordionItem value={label} className="border-0">
                    <div
                        className={`flex items-center justify-between gap-2 px-3 ${collapseHeaderClass}`}
                    >
                        <AccordionTrigger className="flex-1 py-0">{label}</AccordionTrigger>
                        {/* antd's `extra` slot: actions that must not toggle the panel. */}
                        <div
                            className="flex items-center gap-2"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center gap-2">
                                {enableSearch && isCodeMode && (
                                    <EnhancedButton
                                        icon={<MagnifyingGlassIcon size={14} />}
                                        type={isSearchOpen ? "primary" : "text"}
                                        onClick={() => setIsSearchOpen((prev) => !prev)}
                                        size="small"
                                        tooltipProps={{title: "Search"}}
                                    />
                                )}
                                {enableFormatSwitcher &&
                                    availableViewModes.length > 1 &&
                                    (availableViewModes.length === 2 &&
                                    availableViewModes[0] === "json" &&
                                    availableViewModes[1] === "yaml" ? (
                                        <Segmented
                                            value={panelViewMode}
                                            onChange={(value) =>
                                                setPanelViewMode(value as PanelViewMode)
                                            }
                                            options={[
                                                {label: "JSON", value: "json"},
                                                {label: "YAML", value: "yaml"},
                                            ]}
                                        />
                                    ) : (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <span className="inline-flex">
                                                    <EnhancedButton size="small" type="text">
                                                        {PANEL_VIEW_MODE_LABELS[panelViewMode]}
                                                        <CaretUpDown size={14} />
                                                    </EnhancedButton>
                                                </span>
                                            </DropdownMenuTrigger>
                                            {/* antd sized this overlay 168px minimum. */}
                                            <DropdownMenuContent
                                                align="end"
                                                className="min-w-[168px]"
                                            >
                                                {viewModeMenuItems.map((item) => (
                                                    <DropdownMenuItem
                                                        key={item.key}
                                                        onSelect={() =>
                                                            setPanelViewMode(
                                                                item.key as PanelViewMode,
                                                            )
                                                        }
                                                    >
                                                        {item.label}
                                                    </DropdownMenuItem>
                                                ))}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    ))}
                                <CopyButton
                                    text={copyText}
                                    icon={true}
                                    buttonText={null}
                                    stopPropagation
                                    size="icon-sm"
                                />
                            </div>
                        </div>
                    </div>
                    <AccordionContent className={collapsePanelClass}>
                        <div
                            ref={editorRef}
                            style={{
                                height: fullEditorHeight ? "100%" : "auto",
                                maxHeight: fullEditorHeight ? "none" : 800,
                                overflowY: "auto",
                            }}
                        >
                            {isCodeMode ? (
                                <DrillInProvider
                                    value={{
                                        enabled: false,
                                        decodeEscapedJsonStrings: panelViewMode === "decoded-json",
                                    }}
                                >
                                    <EditorProvider
                                        codeOnly={true}
                                        enableTokens={false}
                                        showToolbar={false}
                                        className={
                                            "[&_.agenta-editor-wrapper]:bg-[inherit] [&_.editor-code]:bg-transparent [&_.editor-code]:m-0"
                                        }
                                        readOnly
                                        disabled
                                        noProvider
                                    >
                                        <LanguageAwareViewer
                                            initialValue={
                                                panelViewMode === "yaml"
                                                    ? yamlOutput
                                                    : panelViewMode === "decoded-json"
                                                      ? decodedJsonOutput
                                                      : jsonOutput
                                            }
                                            language={panelViewMode}
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
                            ) : isPrettyMode ? (
                                <PrettyJsonViewSlot
                                    data={prettyJsonSource}
                                    keyPrefix={`accordion-${textViewerId}`}
                                />
                            ) : (
                                <TextModeViewer
                                    editorId={`accordion-${textViewerId}`}
                                    value={textOutput}
                                    mode={panelViewMode as "text" | "markdown"}
                                />
                            )}
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>
    )

    return (
        <>
            {collapse}
            {fileAttachments?.length || imageAttachments?.length ? (
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
                                    <span className="text-[12px] truncate">
                                        {file.filename || `File ${index + 1}`}
                                    </span>
                                </div>
                                <div className="flex gap-1.5 shrink-0 invisible group-hover:visible">
                                    <EnhancedButton
                                        icon={<DownloadIcon size={10} className="mb-[1px]" />}
                                        size="small"
                                        tooltipProps={{title: "Download"}}
                                        className="!w-5 !h-5"
                                        onClick={(e) => {
                                            e.preventDefault()
                                            downloadFile(file.data)
                                        }}
                                    />
                                    <EnhancedButton
                                        icon={<CopyIcon size={10} className="mb-[1px]" />}
                                        size="small"
                                        tooltipProps={{title: "Copy URL"}}
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
        </>
    )
}

export default AccordionTreePanel
