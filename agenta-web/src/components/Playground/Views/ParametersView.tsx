import {Dispatch, useState} from "react"
import React from "react"
import {Parameter} from "@/lib/Types"
import {Row, Col, Button, Tooltip, message, Space, Collapse} from "antd"
import type {CollapseProps} from "antd"
import {ModelParameters, StringParameters, ObjectParameters} from "./ParametersCards"
import {createUseStyles} from "react-jss"
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
    setUnSavedChanges: Dispatch<React.SetStateAction<boolean>>
}

const useStyles = createUseStyles({
    container: {
        width: "100%",
    },
    row: {
        marginTop: 16,
        marginBottom: 8,
    },
    h2: {
        padding: "0px",
        margin: "0px",
    },
    col: {
        textAlign: "right",
        paddingRight: "25px",
    },
    collapse: {
        padding: 0,
        width: "100%",
    },
})

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
    setUnSavedChanges,
}) => {
    const classes = useStyles()
    const [inputValue, setInputValue] = useState(1)
    const [messageApi, contextHolder] = message.useMessage()
    const onChange = (param: Parameter, newValue: number | string) => {
        setInputValue(+newValue)
        handleParamChange(param.name, newValue)
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
        const newValue = Array.isArray(key) && key.includes("1") ? "1" : ""
        setIsParamsCollapsed(newValue)
    }
    const items: CollapseProps["items"] = [
        {
            key: "1",
            label: (
                <div className={classes.container}>
                    <Row className={classes.row}>
                        <Col span={12}>
                            <h2 className={classes.h2}>1. Modify Parameters</h2>
                        </Col>
                        <Col span={12} className={classes.col}>
                            <Space>
                                <Button
                                    type="primary"
                                    onClick={async () => {
                                        await onOptParamsChange(optParams!, true, isPersistent)
                                        success()
                                        setUnSavedChanges(false)
                                    }}
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
                <div className={classes.container}>
                    <StringParameters optParams={optParams} handleParamChange={handleParamChange} />
                    <ObjectParameters optParams={optParams} handleParamChange={handleParamChange} />

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
                onChange={onChangeCollapse}
                className={classes.collapse}
                collapsible="icon"
            />
        </div>
    )
}
export default ParametersView
