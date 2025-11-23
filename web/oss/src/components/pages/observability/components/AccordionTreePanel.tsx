import {useCallback, useEffect, useMemo, useRef, useState} from "react"
import dynamic from "next/dynamic"
import {Copy, Download, FileText, MarkdownLogoIcon, TextAa} from "@phosphor-icons/react"
import {Collapse, Radio, Space} from "antd"
import yaml from "js-yaml"
import {createUseStyles} from "react-jss"

import CopyButton from "@/oss/components/CopyButton/CopyButton"
import {EditorProvider, useLexicalComposerContext} from "@/oss/components/Editor/Editor"
import EditorWrapper from "@/oss/components/Editor/Editor"
import {ON_CHANGE_LANGUAGE} from "@/oss/components/Editor/plugins/code"
import {TOGGLE_MARKDOWN_VIEW} from "@/oss/components/Editor/plugins/markdown/commands"
import EnhancedButton from "@/oss/components/Playground/assets/EnhancedButton"
import {getStringOrJson, sanitizeDataWithBlobUrls} from "@/oss/lib/helpers/utils"
import {JSSTheme} from "@/oss/lib/Types"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
const ImagePreview = dynamic(() => import("@/oss/components/Common/ImagePreview"), {ssr: false})

type AccordionTreePanelProps = {
    value: Record<string, any> | string | any[]
    label: string
    enableFormatSwitcher?: boolean
    bgColor?: string
    fullEditorHeight?: boolean
} & React.ComponentProps<typeof Collapse>

const useStyles = createUseStyles((theme: JSSTheme) => ({
    collapseContainer: ({bgColor}: {bgColor?: string}) => ({
        backgroundColor: "unset",
        display: "flex",
        flexDirection: "column",
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
}))

const LanguageAwareViewer = ({
    initialValue,
    language,
}: {
    initialValue: string
    language: "json" | "yaml"
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
        />
    )
}

const MarkdownToggleButton = () => {
    const [editor] = useLexicalComposerContext()
    const [markdownView, setMarkdownView] = useState(false)

    return (
        <EnhancedButton
            icon={!markdownView ? <TextAa size={14} /> : <MarkdownLogoIcon size={14} />}
            type="text"
            onClick={() => {
                setMarkdownView((prev) => !prev)
                editor.dispatchCommand(TOGGLE_MARKDOWN_VIEW, undefined)
            }}
            tooltipProps={{
                title: !markdownView ? "Preview text" : "Preview markdown",
            }}
        />
    )
}

const AccordionTreePanel = ({
    value: incomingValue,
    label,
    enableFormatSwitcher = false,
    bgColor,
    fullEditorHeight = false,
    ...props
}: AccordionTreePanelProps) => {
    const classes = useStyles({bgColor})
    const [segmentedValue, setSegmentedValue] = useState<"json" | "yaml">("json")
    const editorRef = useRef<HTMLDivElement>(null)

    const {
        data: sanitizedValue,
        fileAttachments,
        imageAttachments,
    } = useMemo(() => {
        return sanitizeDataWithBlobUrls(incomingValue)
    }, [incomingValue])
    const isStringValue = typeof sanitizedValue === "string"

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
                                    />
                                </EditorProvider>
                            )}
                        </div>
                    ),
                    extra: (
                        <Space size={12} onClick={(e) => e.stopPropagation()}>
                            {enableFormatSwitcher && !isStringValue && (
                                <Radio.Group
                                    value={segmentedValue}
                                    onChange={(e) =>
                                        setSegmentedValue(e.target.value as "json" | "yaml")
                                    }
                                >
                                    <Radio.Button value="json">JSON</Radio.Button>
                                    <Radio.Button value="yaml">YAML</Radio.Button>
                                </Radio.Group>
                            )}
                            {isStringValue && <MarkdownToggleButton />}
                            <CopyButton
                                text={
                                    segmentedValue === "json"
                                        ? getStringOrJson(sanitizedValue)
                                        : yamlOutput
                                }
                                icon={true}
                                buttonText={null}
                                stopPropagation
                            />
                        </Space>
                    ),
                },
            ]}
            className={classes.collapseContainer}
            bordered={false}
        />
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
            {fileAttachments?.length || imageAttachments?.length ? (
                <div className="flex flex-col gap-2 mb-4">
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
                                    <FileText size={16} className="shrink-0" />
                                    <span className="text-[10px] truncate">
                                        {file.filename || `File ${index + 1}`}
                                    </span>
                                </div>
                                <div className="flex gap-1.5 shrink-0 invisible group-hover:visible">
                                    <EnhancedButton
                                        icon={<Download size={10} className="mb-[1px]" />}
                                        size="small"
                                        tooltipProps={{title: "Download"}}
                                        className="!w-5 !h-5"
                                        onClick={(e) => {
                                            e.preventDefault()
                                            downloadFile(file.data)
                                        }}
                                    />
                                    <EnhancedButton
                                        icon={<Copy size={10} className="mb-[1px]" />}
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

            {collapse}
        </>
    )
}

export default AccordionTreePanel
