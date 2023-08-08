import {useState} from "react"
import React from "react"
import {Parameter} from "@/lib/Types"
import {Input, Row, Col, Button, Tooltip, message, Space, Card, Collapse} from "antd"
import type {CollapseProps} from "antd"
import {ModelParameters, StringParameters, ObjectParameters} from "./ParametersCards"
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
    isParamsCollapsed: string
    setIsParamsCollapsed: (value: string) => void
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
        console.log("onChangeCollapse triggered with key:", key)

        const newValue = Array.isArray(key) && key.includes("1") ? "1" : ""
        console.log("Setting isParamsCollapsed to:", newValue)
        setIsParamsCollapsed(newValue)
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
                    <StringParameters optParams={optParams} handleParamChange={handleParamChange} />
                    <ObjectParameters optParams={optParams} />

                    <ModelParameters
                        optParams={optParams}
                        onChange={onChange}
                        handleParamChange={handleParamChange}
                    />
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
                defaultActiveKey={["1"]}
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
