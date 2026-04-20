import {useCallback, useEffect, useLayoutEffect, useId, useMemo, useRef, useState} from "react"

import {
    CopyButton,
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
    CaretUpDown,
    CopyIcon,
    DownloadIcon,
    FileTextIcon,
    MagnifyingGlassIcon,
    XIcon,
} from "@phosphor-icons/react"
import {Button, Collapse, Dropdown, Input, Radio, Space, theme} from "antd"
import yaml from "js-yaml"
import dynamic from "next/dynamic"
import {createUseStyles} from "react-jss"

import {BeautifiedJsonView} from "@/oss/components/DrillInView/BeautifiedJsonView"
import {
    buildDecodedJsonOutput,
    normalizeEscapedLineBreaks,
    parseStructuredJson,
} from "@/oss/components/DrillInView/decodedJsonHelpers"
import EnhancedButton from "@/oss/components/EnhancedUIs/Button"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {getStringOrJson, sanitizeDataWithBlobUrls} from "@/oss/lib/helpers/utils"
import {JSSTheme} from "@/oss/lib/Types"
const ImagePreview = dynamic(
    () =>
        import("@agenta/ui/components/presentational").then((mod) => ({
            default: mod.ImagePreview,
        })),
    {ssr: false},
)

type AccordionTreePanelProps = {
    value: Record<string, any> | string | any[]
    label: string
    enableFormatSwitcher?: boolean
    bgColor?: string
    fullEditorHeight?: boolean
    enableSearch?: boolean
    viewModePreset?: "default" | "message"
} & React.ComponentProps<typeof Collapse>

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
 *   decode escaped newlines). Default for non-message data.
 * - `beautified-json`: custom component tree (chat bubbles, per-key fields,
 *   envelope unwrap, noise stripping). Default for `viewModePreset="message"`.
 * - `text` / `markdown`: prose editor.
 */
type PanelViewMode = "json" | "yaml" | "decoded-json" | "beautified-json" | "text" | "markdown"

const PANEL_VIEW_MODE_LABELS: Record<PanelViewMode, string> = {
    json: "JSON",
    yaml: "YAML",
    "decoded-json": "Decoded JSON",
    "beautified-json": "Beautified JSON",
    text: "Text",
    markdown: "Markdown",
}

const getDefaultPanelViewMode = (
    availableModes: PanelViewMode[],
    {preferBeautified = false}: {preferBeautified?: boolean} = {},
): PanelViewMode => {
    if (preferBeautified && availableModes.includes("beautified-json")) return "beautified-json"
    if (availableModes.includes("decoded-json")) return "decoded-json"
    return availableModes[0] ?? "json"
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    collapseContainer: ({bgColor}: {bgColor?: string}) => ({
        backgroundColor: "unset",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        "& .ant-collapse-item": {
            display: "flex !important",
            flexDirection: "column",
            height: "100%",
            background: theme.colorFillAlter,
            borderRadius: `${theme.borderRadiusLG}px !important`,
            border: `1px solid ${theme.colorBorder}`,
            overflowY: "auto",
        },
        "& .ant-collapse-item:last-child": {
            borderBottom: `1px solid ${theme.colorBorder}`,
        },
        "& .ant-collapse-header": {
            alignItems: "center !important",
            height: 42,
            backgroundColor: `${theme.colorBgContainer} !important`,
        },
        "& .ant-collapse-panel": {
            borderTop: `1px solid ${theme.colorBorder} !important`,
            padding: `0px`,
            lineHeight: theme.lineHeight,
            backgroundColor: `${bgColor || theme.colorBgContainer} !important`,
            borderBottomLeftRadius: theme.borderRadius,
            borderBottomRightRadius: theme.borderRadius,
            fontSize: theme.fontSize,
            flexGrow: 1,
            "& .ant-collapse-body": {
                height: "100%",
                padding: "0px !important",
            },
        },
    }),
    editor: ({bgColor}: {bgColor?: string}) => ({
        "& .agenta-editor-wrapper": {
            backgroundColor: bgColor,
        },
        "& .editor-code": {
            backgroundColor: "transparent",
            margin: 0,
        },
    }),
    searchBar: {
        position: "absolute",
        top: 48,
        right: 24,
        zIndex: 100,
        background: "#fff",
        borderRadius: 6,
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        display: "flex",
        alignItems: "center",
        padding: 4,
        gap: 4,
        border: `1px solid ${theme.colorBorder}`,
    },
}))

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
    ...props
}: AccordionTreePanelProps) => {
    const {token} = theme.useToken()
    const classes = useStyles({bgColor, theme: token})
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
                modes.push("decoded-json", "beautified-json")
            }
            return modes
        }

        if (isStringValue) {
            if (parsedStructuredString !== null) {
                return ["json", "yaml", "decoded-json", "beautified-json", "text", "markdown"]
            }
            return ["text", "markdown"]
        }

        return ["json", "yaml", "decoded-json", "beautified-json"]
    }, [viewModePreset, isStringValue, hasStructuredValue, parsedStructuredString])
    const [panelViewMode, setPanelViewMode] = useState<PanelViewMode>(() =>
        getDefaultPanelViewMode(availableViewModes, {
            preferBeautified: viewModePreset === "message",
        }),
    )

    useEffect(() => {
        if (!availableViewModes.includes(panelViewMode)) {
            setPanelViewMode(
                getDefaultPanelViewMode(availableViewModes, {
                    preferBeautified: viewModePreset === "message",
                }),
            )
        }
    }, [availableViewModes, panelViewMode, viewModePreset])

    const isCodeMode =
        panelViewMode === "json" || panelViewMode === "yaml" || panelViewMode === "decoded-json"
    const isBeautifiedMode = panelViewMode === "beautified-json"

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
        } catch (error: any) {
            console.error("Failed to convert value to YAML:", error)
            return `Error: Failed to convert content to YAML. (${error?.message || "Unknown error"})`
        }
    }, [panelViewMode, isStringValue, parsedStructuredString, sanitizedValue])

    const decodedJsonOutput = useMemo(() => {
        if (panelViewMode !== "decoded-json") return ""
        return buildDecodedJsonOutput(sanitizedValue, parsedStructuredString)
    }, [panelViewMode, sanitizedValue, parsedStructuredString])

    const beautifiedJsonSource = useMemo(() => {
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
                : panelViewMode === "beautified-json"
                  ? JSON.stringify(beautifiedJsonSource, null, 2)
                  : textOutput

    const collapse = (
        <div className="relative">
            {isSearchOpen && (
                <div className={classes.searchBar}>
                    <Input
                        size="small"
                        placeholder="Search..."
                        value={searchTerm}
                        onChange={(e) => {
                            setSearchTerm(e.target.value)
                            setCurrentResultIndex(0)
                        }}
                        onPressEnter={handleNextMatch}
                        autoFocus
                        style={{width: 150}}
                        suffix={
                            resultCount > 0 ? (
                                <span className="text-xs text-gray-400">
                                    {currentResultIndex + 1}/{resultCount}
                                </span>
                            ) : null
                        }
                    />
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
            <Collapse
                {...props}
                defaultActiveKey={[label]}
                items={[
                    {
                        key: label,
                        label,
                        children: (
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
                                            decodeEscapedJsonStrings:
                                                panelViewMode === "decoded-json",
                                        }}
                                    >
                                        <EditorProvider
                                            codeOnly={true}
                                            enableTokens={false}
                                            showToolbar={false}
                                            className={classes.editor}
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
                                ) : isBeautifiedMode ? (
                                    <BeautifiedJsonView
                                        data={beautifiedJsonSource}
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
                        ),
                        extra: (
                            <Space size={8} onClick={(e) => e.stopPropagation()}>
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
                                        <Radio.Group
                                            value={panelViewMode}
                                            onChange={(e) =>
                                                setPanelViewMode(e.target.value as PanelViewMode)
                                            }
                                            size="small"
                                        >
                                            <Radio.Button value="json">JSON</Radio.Button>
                                            <Radio.Button value="yaml">YAML</Radio.Button>
                                        </Radio.Group>
                                    ) : (
                                        <Dropdown
                                            trigger={["click"]}
                                            menu={{
                                                items: viewModeMenuItems,
                                                selectable: true,
                                                selectedKeys: [panelViewMode],
                                            }}
                                            overlayStyle={{minWidth: 168}}
                                        >
                                            <Button size="small" type="text">
                                                {PANEL_VIEW_MODE_LABELS[panelViewMode]}
                                                <CaretUpDown size={14} />
                                            </Button>
                                        </Dropdown>
                                    ))}
                                <CopyButton
                                    text={copyText}
                                    icon={true}
                                    buttonText={null}
                                    stopPropagation
                                    size="small"
                                />
                            </Space>
                        ),
                    },
                ]}
                className={classes.collapseContainer}
                bordered={false}
            />
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
                                    <span className="text-[10px] truncate">
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
