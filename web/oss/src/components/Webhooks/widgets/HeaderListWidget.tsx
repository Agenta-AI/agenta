import {Button} from "@agenta/primitive-ui/components/button"
import {Input} from "@agenta/primitive-ui/components/input"
import {MinusCircleOutlined, PlusOutlined} from "@ant-design/icons"
import {Form} from "antd"

export const HeaderListWidget = () => {
    return (
        <div>
            <span className="mb-2 block">Custom Headers (optional)</span>
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
                                    onClick={() => remove(field.name)}
                                    variant="destructive"
                                    size="icon"
                                >
                                    {<MinusCircleOutlined />}
                                </Button>
                            </div>
                        ))}
                        <Button
                            onClick={() => add()}
                            variant="outline"
                            className="border-dashed w-full"
                        >
                            {<PlusOutlined />}
                            Add header
                        </Button>
                    </div>
                )}
            </Form.List>
        </div>
    )
}
