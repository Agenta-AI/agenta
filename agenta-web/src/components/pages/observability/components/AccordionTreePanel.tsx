import CopyButton from "@/components/CopyButton/CopyButton"
import {getStringOrJson} from "@/lib/helpers/utils"
import {JSSTheme} from "@/lib/Types"
import {Collapse, Radio, Space} from "antd"
import React, {useState, useMemo, useRef, useEffect} from "react"
import {createUseStyles} from "react-jss"
import yaml from "js-yaml"
import {Editor} from "@monaco-editor/react"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"

type AccordionTreePanelProps = {
    value: Record<string, any>
    label: string
    enableFormatSwitcher?: boolean
    bgColor?: string
    fullEditorHeight?: boolean
} & React.ComponentProps<typeof Collapse>

const useStyles = createUseStyles((theme: JSSTheme) => ({
    collapseContainer: ({bgColor}: {bgColor?: string}) => ({
        backgroundColor: "unset",
        height: "100%",
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
        "& .monaco-editor .monaco-editor-background": {
            backgroundColor: bgColor,
        },
        "& .monaco-editor .margin": {
            backgroundColor: bgColor,
        },
        "& .monaco-editor .scrollbar.vertical .slider": {
            borderRadius: 6,
        },
        "& .monaco-editor .scrollbar.vertical": {
            backgroundColor: theme.colorBgContainerDisabled,
        },
    }),
}))

const AccordionTreePanel = ({
    value,
    label,
    enableFormatSwitcher = false,
    bgColor,
    fullEditorHeight = false,
    ...props
}: AccordionTreePanelProps) => {
    const classes = useStyles({bgColor})
    const {appTheme} = useAppTheme()
    const [segmentedValue, setSegmentedValue] = useState("JSON")
    const editorRef = useRef<HTMLDivElement>(null)
    const [editorHeight, setEditorHeight] = useState(200)

    const yamlOutput = useMemo(() => {
        if (segmentedValue === "YAML" && value && Object.keys(value).length) {
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

    useEffect(() => {
        setEditorHeight(Math.min(editorRef.current?.clientHeight || 200, 800))
    }, [value, label, segmentedValue, yamlOutput])

    return (
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
                                height: fullEditorHeight ? "100%" : `${editorHeight}px`,
                                maxHeight: fullEditorHeight ? "none" : 800,
                                overflowY: "auto",
                            }}
                        >
                            <Editor
                                className={classes.editor}
                                height={fullEditorHeight ? "100%" : `${editorHeight}px`}
                                language={
                                    typeof value === "string"
                                        ? "markdown"
                                        : segmentedValue === "JSON"
                                          ? "json"
                                          : "yaml"
                                }
                                theme={`vs-${appTheme}`}
                                value={
                                    segmentedValue === "JSON" ? getStringOrJson(value) : yamlOutput
                                }
                                options={{
                                    wordWrap: "on",
                                    minimap: {enabled: false},
                                    scrollBeyondLastLine: false,
                                    automaticLayout: true,
                                    readOnly: true,
                                    lineNumbers: "off",
                                    lineDecorationsWidth: 0,
                                    padding: {
                                        top: 10,
                                        bottom: 10,
                                    },
                                    scrollbar: {
                                        verticalScrollbarSize: 8,
                                        horizontalScrollbarSize: 8,
                                        alwaysConsumeMouseWheel: false,
                                    },
                                    stickyScroll: {
                                        scrollWithEditor: true,
                                    },
                                }}
                                onMount={(editor) => {
                                    const model = editor.getModel()

                                    if (model) {
                                        const updateHeight = () => {
                                            const contentHeight = editor.getContentHeight()
                                            setEditorHeight(contentHeight)
                                        }
                                        editor.onDidContentSizeChange(updateHeight)
                                        updateHeight()
                                    }
                                }}
                            />
                        </div>
                    ),
                    extra: (
                        <Space size={12}>
                            {enableFormatSwitcher && typeof value !== "string" && (
                                <Radio.Group
                                    value={segmentedValue}
                                    onChange={(e) => setSegmentedValue(e.target.value)}
                                >
                                    <Radio.Button value="JSON">JSON</Radio.Button>
                                    <Radio.Button value="YAML">YAML</Radio.Button>
                                </Radio.Group>
                            )}
                            <CopyButton
                                text={
                                    segmentedValue === "JSON" ? getStringOrJson(value) : yamlOutput
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
}

export default AccordionTreePanel
