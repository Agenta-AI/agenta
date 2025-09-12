import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {MarkdownLogoIcon, TextAa} from "@phosphor-icons/react"
import {Collapse, Radio, Space} from "antd"
import yaml from "js-yaml"
import {createUseStyles} from "react-jss"

import CopyButton from "@/oss/components/CopyButton/CopyButton"
import {EditorProvider, useLexicalComposerContext} from "@/oss/components/Editor/Editor"
import EditorWrapper from "@/oss/components/Editor/Editor"
import {ON_CHANGE_LANGUAGE} from "@/oss/components/Editor/plugins/code"
import {TOGGLE_MARKDOWN_VIEW} from "@/oss/components/Editor/plugins/markdown/commands"
import EnhancedButton from "@/oss/components/Playground/assets/EnhancedButton"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {JSSTheme} from "@/oss/lib/Types"

type AccordionTreePanelProps = {
    value: Record<string, any> | string
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
    value,
    label,
    enableFormatSwitcher = false,
    bgColor,
    fullEditorHeight = false,
    ...props
}: AccordionTreePanelProps) => {
    const classes = useStyles({bgColor})
    const [segmentedValue, setSegmentedValue] = useState<"json" | "yaml">("json")
    const editorRef = useRef<HTMLDivElement>(null)

    const yamlOutput = useMemo(() => {
        if (segmentedValue === "yaml" && value && Object.keys(value).length) {
            try {
                const jsonObject = JSON.parse(getStringOrJson(value))
                return yaml.dump(jsonObject)
            } catch (error: any) {
                console.error("Failed to convert JSON to YAML:", error)
                return `Error: Failed to convert JSON to YAML. Please ensure the data is valid. (${error?.message})`
            }
        }
        return ""
    }, [segmentedValue, value])

    console.log("segmentedValue", segmentedValue, value, yamlOutput)
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
                            {typeof value === "string" ? (
                                <div className="p-2">
                                    <EditorWrapper
                                        initialValue={value}
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
                                                ? getStringOrJson(value)
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
                            {enableFormatSwitcher && typeof value !== "string" && (
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
                            {typeof value === "string" && <MarkdownToggleButton />}
                            <CopyButton
                                text={
                                    segmentedValue === "json" ? getStringOrJson(value) : yamlOutput
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

    if (typeof value === "string") {
        return (
            <EditorProvider
                initialValue={value}
                disabled
                showToolbar={false}
                className={classes.editor}
                readOnly
            >
                {collapse}
            </EditorProvider>
        )
    }

    return collapse
}

export default AccordionTreePanel
