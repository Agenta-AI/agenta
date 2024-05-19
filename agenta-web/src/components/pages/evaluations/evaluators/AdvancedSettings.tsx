import React from "react"
import {Form, Input, Collapse} from "antd"
import {CaretRightOutlined} from "@ant-design/icons"
import {createUseStyles} from "react-jss"

type AdvancedSettings = {
    correct_answer_keys: string[]
}

const useStyles = createUseStyles((theme: any) => ({
    label: {
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
    },
}))

type AdvancedSettingsProps = {
    settings: Record<string, any>[]
}

const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({settings}) => {
    const classes = useStyles()

    const initialValues = settings.reduce((acc, field) => {
        acc[field.key] = field.default
        return acc
    }, {})

    return (
        <Collapse
            bordered={false}
            expandIcon={({isActive}) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
            className={"my-[10px]"}
        >
            <Collapse.Panel key="1" header="Advanced Settings">
                {settings.map((field) => (
                    <Form.Item
                        key={field.key}
                        initialValue={initialValues.correct_answer_keys[0]}
                        name={["settings_values", "correct_answer_keys"]}
                        label={
                            <div className={classes.label}>
                                <span>{field.label}</span>
                            </div>
                        }
                        rules={[
                            {required: field.required ?? true, message: "This field is required"},
                        ]}
                    >
                        {field.key === "correct_answer_keys" && <Input />}
                    </Form.Item>
                ))}
            </Collapse.Panel>
        </Collapse>
    )
}

export default AdvancedSettings
