import {type FC, type ReactNode} from "react"

import {Form, Input, InputNumber, Switch, Typography} from "antd"
import clsx from "clsx"

import TreeRow from "../shared/TreeRow"

import {BaseNodeProps} from "./NodeTypes"

export interface PrimitiveNodeProps extends BaseNodeProps {
    customRender?: any
}

const {Text} = Typography

const PrimitiveNodeComponent: FC<PrimitiveNodeProps> = ({
    className,
    path,
    k,
    value,
    depth,
    handleRename,
}) => {
    let input: ReactNode = <Input.TextArea rows={3} variant="borderless" autoSize />

    if (typeof value === "number")
        input = <InputNumber style={{width: "100%", textAlign: "right"}} variant="borderless" />
    else if (typeof value === "boolean") input = <Switch />
    else if (typeof value === "string") input = <Input variant="borderless" />

    return (
        <TreeRow depth={depth} className={clsx("primitive", className)}>
            {typeof k === "number" ? (
                <Text className="text-xs font-semibold leading-5 mr-1">{k}</Text>
            ) : (
                <Text
                    className="text-xs font-semibold leading-5 mr-1"
                    editable={{
                        icon: null,
                        triggerType: ["text"],
                        autoSize: true,
                        onChange: (newKey) => {
                            const trimmed = newKey.trim()
                            if (trimmed && trimmed !== k) {
                                handleRename(path, trimmed)
                            }
                        },
                    }}
                >
                    {k}
                </Text>
            )}
            <Form.Item
                name={path}
                style={{flex: 1, marginBottom: 0, lineHeight: "20px"}}
                valuePropName={typeof value === "boolean" ? "checked" : "value"}
            >
                {input}
            </Form.Item>
        </TreeRow>
    )
}

export default PrimitiveNodeComponent
