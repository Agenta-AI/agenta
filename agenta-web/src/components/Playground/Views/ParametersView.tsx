import React, {Dispatch, useEffect, useState} from "react"
import {Environment, Parameter, Variant} from "@/lib/Types"
import {Row, Col, Button, Tooltip, message, Space, Collapse} from "antd"
import type {CollapseProps} from "antd"
import {createUseStyles} from "react-jss"
import {ModelParameters, ObjectParameters, StringParameters} from "./ParametersCards"
import PublishVariantModal from "./PublishVariantModal"
import {fetchVariants} from "@/lib/services/api"
import {useRouter} from "next/router"

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
    environments: Environment[]
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
    environments,
}) => {
    const classes = useStyles()
    const [inputValue, setInputValue] = useState(1)
    const [messageApi, contextHolder] = message.useMessage()

    const [isPublishModalOpen, setPublishModalOpen] = useState(false)

    // Check if the variant exists and display the publish button if it does
    const router = useRouter()
    const appName = router.query.app_name?.toString() || ""
    const [isVariantExisting, setIsVariantExisting] = useState(false)
    const fetchVariant = async () => {
        const variants: Variant[] = await fetchVariants(appName)
        const isExisting = variants.some((variant) => variant.variantName === variantName)

        setIsVariantExisting(isExisting)
    }
    useEffect(() => {
        fetchVariant()
    }, [appName, variantName])

    const onChange = (param: Parameter, newValue: number | string) => {
        setInputValue(+newValue)
        handleParamChange(param.name, newValue)
        setUnSavedChanges(true)
    }
    const handleParamChange = (name: string, newVal: any) => {
        const newOptParams = optParams?.map((param) =>
            param.name === name ? {...param, default: newVal} : param,
        )
        newOptParams && onOptParamsChange(newOptParams, false, false)
        setUnSavedChanges(true)
    }
    const success = () => {
        fetchVariant()
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
                                {isVariantExisting && (
                                    <Button onClick={() => setPublishModalOpen(true)}>
                                        <Tooltip
                                            placement="bottom"
                                            title="Publish the variant to different environments"
                                        >
                                            Publish
                                        </Tooltip>
                                    </Button>
                                )}
                                <Button
                                    type="primary"
                                    onClick={async () => {
                                        await onOptParamsChange(optParams!, true, isPersistent)
                                        setUnSavedChanges(false)
                                        success()
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
            <PublishVariantModal
                variantName={variantName}
                isModalOpen={isPublishModalOpen}
                setIsModalOpen={setPublishModalOpen}
                environments={environments}
            />
        </div>
    )
}
export default ParametersView
