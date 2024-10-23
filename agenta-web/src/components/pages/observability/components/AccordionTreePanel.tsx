import CopyButton from "@/components/CopyButton/CopyButton"
import {getStringOrJson} from "@/lib/helpers/utils"
import {JSSTheme} from "@/lib/Types"
import {Collapse, Segmented, Space} from "antd"
import React, {useState, useMemo} from "react"
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
            padding: theme.padding,
            lineHeight: theme.lineHeight,
            backgroundColor: `${bgColor || theme.colorBgContainer} !important`,
            borderBottomLeftRadius: theme.borderRadius,
            borderBottomRightRadius: theme.borderRadius,
            fontSize: theme.fontSize,
            height: "100%",
            "& .ant-collapse-content-box": {
                height: "100%",
                padding: "0px !important",
            },
        },
    }),
    editor: ({bgColor}: {bgColor?: string}) => ({
        overflow: "hidden",
        "& .monaco-editor .monaco-editor-background": {
            backgroundColor: bgColor,
        },
        "& .monaco-editor .margin": {
            backgroundColor: bgColor,
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

    return (
        <Collapse
            {...props}
            defaultActiveKey={[label]}
            items={[
                {
                    key: label,
                    label,
                    children: (
                        <Editor
                            className={classes.editor}
                            height={fullEditorHeight ? "100%" : 200}
                            language={
                                typeof value === "string"
                                    ? "markdown"
                                    : segmentedValue === "JSON"
                                      ? "json"
                                      : "yaml"
                            }
                            theme={`vs-${appTheme}`}
                            value={segmentedValue === "JSON" ? getStringOrJson(value) : yamlOutput}
                            options={{
                                wordWrap: "on",
                                minimap: {enabled: false},
                                readOnly: true,
                                lineNumbers: "off",
                                lineDecorationsWidth: 0,
                            }}
                        />
                    ),
                    extra: (
                        <Space size={12}>
                            {enableFormatSwitcher && typeof value !== "string" && (
                                <Segmented
                                    options={["JSON", "YAML"]}
                                    value={segmentedValue}
                                    onChange={(optValue) => {
                                        setSegmentedValue(optValue)
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                />
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
