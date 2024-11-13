import React from "react"
import {
    Form,
    Input,
    InputNumber,
    Switch,
    Tooltip,
    Collapse,
    theme,
    AutoComplete,
    Select,
} from "antd"
import {CaretRightOutlined, InfoCircleOutlined} from "@ant-design/icons"
import {createUseStyles} from "react-jss"
import {Editor} from "@monaco-editor/react"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {generatePaths} from "@/lib/transformers"

const useStyles = createUseStyles((theme: any) => ({
    label: {
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
    },
    editor: {
        border: `1px solid ${theme.colorBorder}`,
        borderRadius: theme.borderRadius,
        overflow: "hidden",
    },
}))

type AdvancedSettingsProps = {
    settings: Record<string, any>[]
    selectedTestcase: {
        testcase: Record<string, any> | null
    }
}

const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({settings, selectedTestcase}) => {
    const classes = useStyles()
    const {appTheme} = useAppTheme()
    const {token} = theme.useToken()

    return (
        <Collapse
            bordered={false}
            expandIcon={({isActive}) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
        >
            <Collapse.Panel
                key="1"
                header="Advanced Settings"
                data-cy="new-evaluator-advance-settings"
                forceRender
            >
                {settings.map((field) => {
                    const rules = [
                        {required: field.required ?? true, message: "This field is required"},
                    ]

                    return (
                        <Form.Item
                            key={field.key}
                            name={["settings_values", field.key]}
                            label={
                                <div className={classes.label}>
                                    <span>{field.label}</span>
                                    {field.description && (
                                        <Tooltip title={field.description}>
                                            <InfoCircleOutlined
                                                style={{color: token.colorPrimary}}
                                            />
                                        </Tooltip>
                                    )}
                                </div>
                            }
                            initialValue={field.default}
                            rules={rules}
                        >
                            {(field.type === "string" || field.type === "regex") &&
                            selectedTestcase.testcase ? (
                                <AutoComplete
                                    options={generatePaths(selectedTestcase)}
                                    data-cy="new-evaluator-advance-settings-input"
                                    filterOption={(inputValue, option) =>
                                        option!.value
                                            .toUpperCase()
                                            .indexOf(inputValue.toUpperCase()) !== -1
                                    }
                                />
                            ) : field.type === "string" || field.type === "regex" ? (
                                <Input data-cy="new-evaluator-advance-settings-input" />
                            ) : field.type === "number" ? (
                                <InputNumber min={field.min} max={field.max} step={0.1} />
                            ) : field.type === "boolean" || field.type === "bool" ? (
                                <Switch />
                            ) : field.type === "text" ? (
                                <Input.TextArea rows={10} />
                            ) : field.type === "code" ? (
                                <Editor
                                    className={classes.editor}
                                    height={400}
                                    width="100%"
                                    language="python"
                                    theme={`vs-${appTheme}`}
                                />
                            ) : field.type === "multiple_choice" ? (
                                <Select
                                    options={field.options?.map((option: string) => ({
                                        label: option,
                                        value: option,
                                    }))}
                                />
                            ) : field.type === "object" ? (
                                <Editor
                                    className={classes.editor}
                                    height={120}
                                    width="100%"
                                    language="json"
                                    options={{lineNumbers: "off"}}
                                    theme={`vs-${appTheme}`}
                                />
                            ) : null}
                        </Form.Item>
                    )
                })}
            </Collapse.Panel>
        </Collapse>
    )
}

export default AdvancedSettings
