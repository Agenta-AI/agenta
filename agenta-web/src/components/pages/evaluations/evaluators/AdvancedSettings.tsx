import React, {useState, useEffect} from "react"
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
    settings: {key: string; label: string; default: string[]; required?: boolean}[]
    form: any
}

const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({settings, form}) => {
    const classes = useStyles()
    const [isCollapsed, setIsCollapsed] = useState(true)

    const handleCollapseChange = (key: string[]) => {
        setIsCollapsed(!key.length)
    }

    useEffect(() => {
        // Initialize the form with default values for advanced settings
        const initialValues = settings.reduce((acc, field) => {
            acc[field.key] = field.default
            return acc
        }, {})
        form.setFieldsValue({advancedSettings: initialValues})
    }, [form, settings])

    console.log("Passed settings to AdvancedSettings:", settings)

    return (
        <Collapse
            bordered={false}
            expandIcon={({isActive}) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
            className={"my-[10px]"}
            onChange={handleCollapseChange}
        >
            <Collapse.Panel key="1" header="Advanced Settings">
                {settings.map((field) => (
                    <Form.Item
                        key={field.key}
                        name={["advancedSettings", field.key]}
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
