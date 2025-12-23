import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    ArrowDownIcon,
    ArrowUpIcon,
    CopyIcon,
    DownloadIcon,
    FileTextIcon,
    MagnifyingGlassIcon,
    MarkdownLogoIcon,
    TextAaIcon,
    XIcon,
} from "@phosphor-icons/react"
import {ButtonProps, Collapse, Input, Radio, Space, theme} from "antd"
import yaml from "js-yaml"
import dynamic from "next/dynamic"
import {createUseStyles} from "react-jss"

import CopyButton from "@/oss/components/CopyButton/CopyButton"
import EditorWrapper, {
    EditorProvider,
    useLexicalComposerContext,
} from "@/oss/components/Editor/Editor"
import {ON_CHANGE_LANGUAGE} from "@/oss/components/Editor/plugins/code"
import {TOGGLE_MARKDOWN_VIEW} from "@/oss/components/Editor/plugins/markdown/commands"
import EnhancedButton from "@/oss/components/EnhancedUIs/Button"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {getStringOrJson, sanitizeDataWithBlobUrls} from "@/oss/lib/helpers/utils"
import {JSSTheme} from "@/oss/lib/Types"
const ImagePreview = dynamic(() => import("@/oss/components/Common/ImagePreview"), {ssr: false})

type AccordionTreePanelProps = {
    value: Record<string, any> | string | any[]
    label: string
    enableFormatSwitcher?: boolean
    bgColor?: string
    fullEditorHeight?: boolean
    enableSearch?: boolean
} & React.ComponentProps<typeof Collapse>

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
        },
        "& .ant-collapse-content": {
            borderTop: `1px solid ${theme.colorBorder} !important`,
            padding: `0px`,
            lineHeight: theme.lineHeight,
            backgroundColor: `${bgColor || theme.colorBgContainer} !important`,
            borderBottomLeftRadius: theme.borderRadius,
            borderBottomRightRadius: theme.borderRadius,
            fontSize: theme.fontSize,
            flexGrow: 1,
            "& .ant-collapse-content-box": {
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
    language: "json" | "yaml"
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
        if (language === "json" || language === "yaml") {
            changeLanguage(language)
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

    return (
        <EditorWrapper
            initialValue={initialValue}
            language={language as "json" | "yaml"}
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

const MarkdownToggleButton = ({...props}: ButtonProps) => {
    const [editor] = useLexicalComposerContext()
    const [markdownView, setMarkdownView] = useState(false)

    return (
        <EnhancedButton
            icon={!markdownView ? <TextAaIcon size={14} /> : <MarkdownLogoIcon size={14} />}
            type="text"
            onClick={() => {
                setMarkdownView((prev) => !prev)
                editor.dispatchCommand(TOGGLE_MARKDOWN_VIEW, undefined)
            }}
            tooltipProps={{
                title: !markdownView ? "Preview text" : "Preview markdown",
            }}
            {...props}
        />
    )
}

const AccordionTreePanel = ({
    value: incomingValue,
    label,
    enableFormatSwitcher = false,
    bgColor,
    fullEditorHeight = false,
    enableSearch = false,
    ...props
}: AccordionTreePanelProps) => {
    const {token} = theme.useToken()
    const classes = useStyles({bgColor, theme: token})
    const [segmentedValue, setSegmentedValue] = useState<"json" | "yaml">("json")
    const editorRef = useRef<HTMLDivElement>(null)

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

    const closeSearch = () => {
        setIsSearchOpen(false)
        setSearchTerm("")
        setResultCount(0)
        setCurrentResultIndex(0)
    }

    const {
        data: sanitizedValue,
        fileAttachments,
        imageAttachments,
    } = useMemo(() => {
        return sanitizeDataWithBlobUrls(incomingValue)
    }, [incomingValue])
    const isStringValue = typeof sanitizedValue === "string"

    useEffect(() => {
        closeSearch()
    }, [sanitizedValue])

    const downloadFile = useCallback((url: string) => {
        const link = document.createElement("a")
        link.href = url
        link.download = ""
        link.click()
    }, [])

    const yamlOutput = useMemo(() => {
        if (
            segmentedValue === "yaml" &&
            sanitizedValue &&
            typeof sanitizedValue === "object" &&
            Object.keys(sanitizedValue).length
        ) {
            try {
                const jsonObject = JSON.parse(getStringOrJson(sanitizedValue))
                return yaml.dump(jsonObject)
            } catch (error: any) {
                console.error("Failed to convert JSON to YAML:", error)
                return `Error: Failed to convert JSON to YAML. Please ensure the data is valid. (${error?.message})`
            }
        }
        return ""
    }, [segmentedValue, sanitizedValue])

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
                                {isStringValue ? (
                                    <div className="p-2">
                                        <EditorWrapper
                                            initialValue={sanitizedValue as string}
                                            disabled
                                            codeOnly={false}
                                            showToolbar={false}
                                            boundHeight={false}
                                            noProvider
                                            readOnly
                                        />
                                    </div>
                                ) : (
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
                                                segmentedValue === "json"
                                                    ? getStringOrJson(sanitizedValue)
                                                    : yamlOutput
                                            }
                                            language={segmentedValue}
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
                                )}
                            </div>
                        ),
                        extra: (
                            <Space size={8} onClick={(e) => e.stopPropagation()}>
                                {enableSearch && !isStringValue && (
                                    <EnhancedButton
                                        icon={<MagnifyingGlassIcon size={14} />}
                                        type={isSearchOpen ? "primary" : "text"}
                                        onClick={() => setIsSearchOpen((prev) => !prev)}
                                        size="small"
                                        tooltipProps={{title: "Search"}}
                                    />
                                )}
                                {enableFormatSwitcher && !isStringValue && (
                                    <Radio.Group
                                        value={segmentedValue}
                                        onChange={(e) =>
                                            setSegmentedValue(e.target.value as "json" | "yaml")
                                        }
                                        size="small"
                                    >
                                        <Radio.Button value="json">JSON</Radio.Button>
                                        <Radio.Button value="yaml">YAML</Radio.Button>
                                    </Radio.Group>
                                )}
                                {isStringValue && <MarkdownToggleButton size="small" />}
                                <CopyButton
                                    text={
                                        segmentedValue === "json"
                                            ? getStringOrJson(sanitizedValue)
                                            : yamlOutput
                                    }
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

    if (isStringValue) {
        return (
            <EditorProvider
                initialValue={sanitizedValue as string}
                disabled
                showToolbar={false}
                className={classes.editor}
                readOnly
            >
                {collapse}
            </EditorProvider>
        )
    }

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
