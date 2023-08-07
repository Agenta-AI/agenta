import {useState} from "react"
import React from "react"
import {Parameter} from "@/lib/Types"
import {
    Input,
    Slider,
    Row,
    Col,
    InputNumber,
    Button,
    Tooltip,
    message,
    Space,
    Card,
    Collapse,
    Select,
} from "antd"
import type {CollapseProps} from "antd"
import {renameVariables} from "@/lib/helpers/utils"
import {is} from "cypress/types/bluebird"
import {Column} from "ag-grid-community"
interface Props {
    variantName: string // The name of the variant
    optParams: Parameter[] | null // The optional parameters
    isParamSaveLoading: boolean // Whether the parameters are currently being saved
    onOptParamsChange: (newOptParams: Parameter[], persist: boolean, updateVariant: boolean) => void
    handlePersistVariant: (variantName: string) => void
    setRemovalVariantName: (variantName: string) => void
    setRemovalWarningModalOpen: (value: boolean) => void
    isDeleteLoading: boolean
    isPersistent: boolean
    isParamsCollapsed: "string"
    setIsParamsCollapsed: (value: "string") => void
}

const ParametersView: React.FC<Props> = ({
    variantName,
    optParams,
    isParamSaveLoading,
    onOptParamsChange,
    handlePersistVariant,
    setRemovalVariantName,
    setRemovalWarningModalOpen,
    isDeleteLoading,
    isPersistent,
    isParamsCollapsed,
    setIsParamsCollapsed,
}) => {
    const [inputValue, setInputValue] = useState(1)
    const [messageApi, contextHolder] = message.useMessage()
    const onChange = (param: Parameter, newValue: number) => {
        setInputValue(newValue)
        handleParamChange(param.name, newValue)
        console.log(optParams)
    }
    const handleParamChange = (name: string, newVal: any) => {
        const newOptParams = optParams?.map((param) =>
            param.name === name ? {...param, default: newVal} : param,
        )
        newOptParams && onOptParamsChange(newOptParams, false, false)
    }
    const success = () => {
        messageApi.open({
            type: "success",
            content: "Changes saved successfully!",
            onClose: () => handlePersistVariant(variantName),
        })
    }
    const onChangeCollapse = (key: string | string[]) => {
        if (key.length > 0) {
            setIsParamsCollapsed("1")
        } else {
            setIsParamsCollapsed("")
        }
    }
    const items: CollapseProps["items"] = [
        {
            key: "1",
            label: (
                <div style={{width: "100%"}}>
                    <Row style={{marginTop: 16, marginBottom: 8}}>
                        <Col span={12}>
                            <h2 style={{padding: "0px", margin: "0px"}}>1. Modify Parameters</h2>
                        </Col>
                        <Col span={12} style={{textAlign: "right", paddingRight: "25px"}}>
                            <Space>
                                <Button
                                    type="primary"
                                    onClick={async () => {
                                        console.log(
                                            "Calling onOptParamsChange with optParams: ",
                                            optParams,
                                            " and isPersistent: ",
                                            true,
                                            " and isPersistent: ",
                                            isPersistent,
                                        )
                                        await onOptParamsChange(optParams!, true, isPersistent)
                                        success()
                                    }}
                                    size="normal"
                                    loading={isParamSaveLoading}
                                >
                                    <Tooltip
                                        placement="bottom"
                                        title="Save the new parameters for the variant permanently"
                                    >
                                        Save changes
                                    </Tooltip>
                                </Button>
                                <Button
                                    type="primary"
                                    danger
                                    size="normal"
                                    onClick={() => {
                                        setRemovalVariantName(variantName)
                                        setRemovalWarningModalOpen(true)
                                    }}
                                    loading={isDeleteLoading}
                                >
                                    <Tooltip
                                        placement="bottom"
                                        title="Delete the variant permanently"
                                    >
                                        Delete Variant
                                    </Tooltip>
                                </Button>
                            </Space>
                        </Col>
                    </Row>
                </div>
            ),
            children: (
                <div style={{width: "100%"}}>
                    {optParams
                        ?.filter((param) => param.type === "string")
                        .map((param, index) => (
                            <Row
                                gutter={0}
                                style={{padding: "0px 0px", width: "100%", marginRight: "16px"}}
                                key={index}
                            >
                                <Card
                                    style={{
                                        marginTop: 16,
                                        width: "100%",
                                        border: "1px solid #ccc",
                                        marginRight: "24px",
                                    }}
                                    bodyStyle={{padding: "4px 16px", border: "0px solid #ccc"}}
                                    headStyle={{minHeight: 44, padding: "0px 12px"}}
                                    title={renameVariables(param.name)}
                                >
                                    <Input.TextArea
                                        rows={5}
                                        defaultValue={param.default}
                                        onChange={(e) =>
                                            handleParamChange(param.name, e.target.value)
                                        }
                                        bordered={false}
                                        style={{padding: "0px 0px"}}
                                    />
                                </Card>
                            </Row>
                        ))}
                    {optParams
                        ?.filter((param) => param.type === "object")
                        .map((param, index) => (
                            <Row
                                gutter={0}
                                style={{padding: "0px 0px", width: "100%", marginRight: "16px"}}
                                key={index}
                            >
                                <Card
                                    style={{
                                        marginTop: 16,
                                        width: "100%",
                                        border: "1px solid #ccc",
                                        marginRight: "24px",
                                    }}
                                    bodyStyle={{padding: "4px 16px", border: "0px solid #ccc"}}
                                    headStyle={{minHeight: 44, padding: "0px 12px"}}
                                    title={renameVariables(param.name)}
                                >
                                    <Row
                                        style={{
                                            alignItems: "center",
                                            marginTop: 12,
                                            marginBottom: 12,
                                        }}
                                    >
                                        <Col span={4}>
                                            <Input.TextArea
                                                rows={1}
                                                placeholder={"variable name"}
                                                maxLength={200}
                                                autoSize={false}
                                                size="small"
                                            />
                                        </Col>
                                        <Col span={4}>
                                            <Button
                                                type="default"
                                                danger
                                                style={{margin: "0px 24px"}}
                                            >
                                                {" "}
                                                Delete
                                            </Button>
                                        </Col>
                                    </Row>
                                    <Button type="default" style={{margin: "12px 0px"}}>
                                        + Add variable
                                    </Button>
                                </Card>
                            </Row>
                        ))}

                    {optParams?.filter((param) => !param.input && param.type === "number").length >
                        0 && (
                        <Row
                            gutter={0}
                            style={{padding: "0px 0px", width: "100%", marginTop: "16px"}}
                        >
                            <Card
                                style={{
                                    marginTop: 16,
                                    width: "100%",
                                    border: "1px solid #ccc",
                                    marginRight: "24px",
                                }}
                                bodyStyle={{
                                    padding: "4px 16px",
                                    margin: "16px 0px",
                                    border: "0px solid #ccc",
                                }}
                                headStyle={{minHeight: 44, padding: "0px 12px"}}
                                title="Model Parameters"
                            >
                                {optParams
                                    ?.filter(
                                        (param) =>
                                            !param.input &&
                                            (param.type === "number" || param.type === "array"),
                                    )
                                    .map((param, index) => (
                                        <Row
                                            key={index}
                                            style={{
                                                alignItems: "center",
                                                marginBottom: 10,
                                            }}
                                        >
                                            <Col span={6}>
                                                <h4
                                                    style={{
                                                        margin: 0,
                                                        padding: 0,
                                                        textAlign: "left",
                                                    }}
                                                >
                                                    {renameVariables(param.name)}
                                                </h4>
                                            </Col>
                                            <Col span={8}>
                                                {param.type === "number" && (
                                                    <Slider
                                                        min={param.minimum}
                                                        max={param.maximum}
                                                        value={
                                                            typeof param.default === "number"
                                                                ? param.default
                                                                : 0
                                                        }
                                                        step={0.01}
                                                        onChange={(value) => onChange(param, value)}
                                                        style={{marginBottom: 8}}
                                                    />
                                                )}
                                                {param.type === "array" && (
                                                    <Select
                                                        defaultValue={param.default}
                                                        onChange={(value) =>
                                                            handleParamChange(param.name, value)
                                                        }
                                                        style={{width: "100%"}}
                                                    >
                                                        {param.enum?.map(
                                                            (value: string, index: number) => (
                                                                <Select.Option
                                                                    key={index}
                                                                    value={value}
                                                                >
                                                                    {value}
                                                                </Select.Option>
                                                            ),
                                                        )}
                                                    </Select>
                                                )}
                                            </Col>
                                            <Col>
                                                {param.type === "number" && (
                                                    <InputNumber
                                                        min={0}
                                                        max={10000}
                                                        style={{margin: "0 16px", width: "100%"}}
                                                        value={param.default}
                                                        onChange={(value) => onChange(param, value)}
                                                    />
                                                )}
                                            </Col>
                                            <Row />
                                        </Row>
                                    ))}
                            </Card>
                        </Row>
                    )}
                </div>
            ),
            showArrow: true,
        },
    ]
    return (
        <div>
            {contextHolder}
            <Collapse
                items={items}
                activeKey={isParamsCollapsed}
                ghost
                bordered={false}
                expandIconPosition="end"
                style={{padding: 0, width: "100%"}}
                onChange={onChangeCollapse}
            />
        </div>
    )
}
export default ParametersView
