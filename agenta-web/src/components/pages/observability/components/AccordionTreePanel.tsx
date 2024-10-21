import CopyButton from "@/components/CopyButton/CopyButton"
import {getStringOrJson} from "@/lib/helpers/utils"
import {JSSTheme} from "@/lib/Types"
import {Collapse, Segmented, Space} from "antd"
import {IBM_Plex_Mono} from "next/font/google"
import React, {useState, useMemo} from "react"
import {createUseStyles} from "react-jss"
import yaml from "js-yaml"

type AccordionTreePanelProps = {
    value: Record<string, any>
    label: string
    enableFormatSwitcher?: boolean
    bgColor?: string
} & React.ComponentProps<typeof Collapse>

const useStyles = createUseStyles((theme: JSSTheme) => ({
    collapseContainer: ({bgColor}: {bgColor?: string}) => ({
        backgroundColor: "unset",
        "& .ant-collapse-item": {
            background: theme.colorFillAlter,
            borderRadius: `${theme.borderRadiusLG}px !important`,
            border: `1px solid ${theme.colorBorder}`,
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
            "& .ant-collapse-content-box": {
                padding: "0px !important",
            },
        },
    }),
}))

const ibm_plex_mono = IBM_Plex_Mono({
    subsets: ["latin"],
    weight: ["400", "500", "600"],
})

const AccordionTreePanel = ({
    value,
    label,
    enableFormatSwitcher = false,
    bgColor,
    ...props
}: AccordionTreePanelProps) => {
    const classes = useStyles({bgColor})
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
            items={[
                {
                    key: label,
                    label,
                    children: (
                        <div className={ibm_plex_mono.className}>
                            {segmentedValue === "JSON" ? getStringOrJson(value) : yamlOutput}
                        </div>
                    ),
                    extra: (
                        <Space size={12}>
                            {enableFormatSwitcher && (
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
