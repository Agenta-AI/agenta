import {MinusCircleOutlined, PlusOutlined} from "@ant-design/icons"
import {Button, Form, Input, Typography} from "antd"

const {Text} = Typography

export const HeaderListWidget = () => {
    return (
        <div>
            <Text className="mb-2 block">
                Custom Headers (optional)
            </Text>
            <Form.List name="header_list">
                {(fields, {add, remove}) => (
                    <div className="w-full">
                        {fields.map((field) => (
                            <div key={field.key} className="mb-2 flex items-start">
                                <div className="mr-2 flex-1">
                                    <Form.Item
                                        {...field}
                                        name={[field.name, "key"]}
                                        className="!mb-0"
                                        rules={[{required: true, message: "Required"}]}
                                    >
                                        <Input placeholder="Key (e.g. X-Custom)" />
                                    </Form.Item>
                                </div>
                                <div className="mr-2 flex-[2]">
                                    <Form.Item
                                        {...field}
                                        name={[field.name, "value"]}
                                        className="!mb-0"
                                        rules={[{required: true, message: "Required"}]}
                                    >
                                        <Input placeholder="Value" />
                                    </Form.Item>
                                </div>
                                <Button
                                    type="text"
                                    danger
                                    icon={<MinusCircleOutlined />}
                                    onClick={() => remove(field.name)}
                                />
                            </div>
                        ))}
                        <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                            Add header
                        </Button>
                    </div>
                )}
            </Form.List>
        </div>
    )
}
