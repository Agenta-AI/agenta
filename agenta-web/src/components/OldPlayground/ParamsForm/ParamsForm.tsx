import React from "react"
import ChatInputs from "@/components/ChatInputs/ChatInputs"
import {GenericObject, Parameter} from "@/lib/Types"
import {renameVariables} from "@/lib/helpers/utils"
import {Form, FormInstance, Image, Input, InputNumber, Switch} from "antd"
import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/lib/Types"

const useStyles = createUseStyles((theme: JSSTheme) => ({
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
        flexDirection: "column",
        "& .ant-input": {
            marginTop: 1,
        },
    },
    cover: {
        objectFit: "cover",
        borderRadius: 6,
    },
    paramValueContainer: {
        "&:disabled": {
            color: "inherit",
            backgroundColor: "inherit",
            cursor: "text",
        },
    },
}))

const ASPECT_RATIO = 1.55

interface Props {
    inputParams: (Parameter & {value: any})[]
    onFinish?: (values: GenericObject) => void
    onParamChange?: (name: string, value: any) => void
    isChatVariant?: boolean
    useChatDefaultValue?: boolean
    form?: FormInstance<GenericObject>
    imageSize?: "small" | "large"
    isPlaygroundComponent?: boolean
    isLoading?: boolean
}

const ParamsForm: React.FC<Props> = ({
    inputParams,
    onFinish,
    onParamChange,
    isChatVariant,
    useChatDefaultValue,
    form,
    imageSize = "small",
    isPlaygroundComponent = false,
    isLoading,
}) => {
    const classes = useStyles()
    const imgHeight = imageSize === "small" ? 90 : 120

    const chat = inputParams.find((param) => param.name === "chat")?.value

    return isChatVariant ? (
        <ChatInputs
            value={useChatDefaultValue ? undefined : chat}
            defaultValue={useChatDefaultValue ? chat : undefined}
            onChange={(val) => onParamChange?.("chat", val)}
            isLoading={isLoading}
        />
    ) : (
        <Form form={form} className={classes.form} onFinish={onFinish}>
            {/*@ts-ignore*/}
            {(_, formInstance) => {
                return inputParams.map((param, index) => {
                    const type =
                        param.type === "file_url"
                            ? "url"
                            : param.type === "integer"
                              ? "number"
                              : param.type

                    return (
                        <Form.Item
                            key={param.name}
                            name={param.name}
                            rules={[
                                {
                                    required: param.required,
                                    message: "This field is required",
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
                                            width={imgHeight * ASPECT_RATIO}
                                            height={imgHeight}
                                            className={classes.cover}
                                            fallback="/assets/fallback.png"
                                            alt={param.name}
                                        />
                                    )}

                                {type === "number" && (
                                    <InputNumber
                                        data-cy={`testview-input-parameters-${index}`}
                                        key={index}
                                        className={
                                            !isPlaygroundComponent
                                                ? classes.paramValueContainer
                                                : ""
                                        }
                                        style={{
                                            height: "54px",
                                            minHeight: "54px",
                                            maxHeight: "186px",
                                            width: "100%",
                                        }}
                                        controls={false}
                                        type={type}
                                        value={param.value}
                                        placeholder={`${renameVariables(param.name)} (${type})`}
                                        onChange={(value) => onParamChange?.(param.name, value)}
                                        disabled={!isPlaygroundComponent}
                                    />
                                )}

                                {type === "string" && (
                                    <Input.TextArea
                                        data-cy={`testview-input-parameters-${index}`}
                                        key={index}
                                        className={
                                            !isPlaygroundComponent
                                                ? classes.paramValueContainer
                                                : ""
                                        }
                                        value={param.value}
                                        placeholder={`${renameVariables(param.name)} (${type})`}
                                        onChange={(e) =>
                                            onParamChange?.(param.name, e.target.value)
                                        }
                                        disabled={!isPlaygroundComponent}
                                        autoSize={{minRows: 2, maxRows: 8}}
                                    />
                                )}

                                {type === "boolean" && (
                                    <Switch
                                        disabled={!isPlaygroundComponent}
                                        value={param.value}
                                        onChange={(checked: boolean) =>
                                            onParamChange?.(param.name, checked)
                                        }
                                    />
                                )}
                            </div>
                        </Form.Item>
                    )
                })
            }}
        </Form>
    )
}

export default ParamsForm
