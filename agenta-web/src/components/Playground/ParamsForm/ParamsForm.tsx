import React from "react"
import ChatInputs from "@/components/ChatInputs/ChatInputs"
import {GenericObject, Parameter} from "@/lib/Types"
import {renameVariables} from "@/lib/helpers/utils"
import {Form, FormInstance, Image, Input} from "antd"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    form: {
        width: "100%",
        "& .ant-form-item": {
            marginBottom: "0px",
        },
    },
    formItemRow: {
        display: "flex",
        gap: "0.5rem",
        alignItems: "flex-start",
        marginTop: "1rem",

        "& .ant-input": {
            marginTop: 1,
        },
    },
    cover: {
        objectFit: "cover",
        borderRadius: 6,
    },
})

interface Props {
    inputParams: (Parameter & {value: any})[]
    onFinish?: (values: GenericObject) => void
    onParamChange?: (name: string, value: any) => void
    isChatVariant?: boolean
    useChatDefaultValue?: boolean
    form?: FormInstance<GenericObject>
}

const ParamsForm: React.FC<Props> = ({
    inputParams,
    onFinish,
    onParamChange,
    isChatVariant,
    useChatDefaultValue,
    form,
}) => {
    const classes = useStyles()

    const chat = inputParams.find((param) => param.name === "chat")?.value

    return isChatVariant ? (
        <ChatInputs
            value={useChatDefaultValue ? undefined : chat}
            defaultValue={useChatDefaultValue ? chat : undefined}
            onChange={(val) => onParamChange?.("chat", val)}
        />
    ) : (
        <Form form={form} className={classes.form} onFinish={onFinish}>
            {/*@ts-ignore*/}
            {(_, formInstance) => {
                return inputParams.map((param, index) => {
                    const type = param.type === "file_url" ? "url" : param.type
                    return (
                        <Form.Item
                            key={param.name}
                            name={param.name}
                            rules={[
                                {
                                    required: param.required,
                                    message: "This field is required",
                                },
                                {
                                    type: type as any,
                                    message: `Must be a valid ${type}`,
                                },
                            ]}
                            initialValue={param.value}
                        >
                            <div className={classes.formItemRow}>
                                {type === "url" &&
                                    param.value &&
                                    formInstance.getFieldError(param.name).length === 0 && (
                                        <Image
                                            src={param.value}
                                            width={140}
                                            height={90}
                                            className={classes.cover}
                                            fallback="/assets/fallback.png"
                                        />
                                    )}
                                <Input.TextArea
                                    data-cy={`testview-input-parameters-${index}`}
                                    key={index}
                                    value={param.value}
                                    placeholder={`${renameVariables(param.name)} (${type})`}
                                    onChange={(e) => onParamChange?.(param.name, e.target.value)}
                                    autoSize={{minRows: 2, maxRows: 8}}
                                />
                            </div>
                        </Form.Item>
                    )
                })
            }}
        </Form>
    )
}

export default ParamsForm
