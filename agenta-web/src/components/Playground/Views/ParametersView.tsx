import {Environment, Parameter, Variant} from "@/lib/Types"
import type {CollapseProps} from "antd"
import {Button, Col, Collapse, Row, Space, Tooltip, message} from "antd"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import {ModelParameters, ObjectParameters, StringParameters} from "./ParametersCards"
import PublishVariantModal from "./PublishVariantModal"
import {removeVariant} from "@/lib/services/api"

interface Props {
    variant: Variant
    optParams: Parameter[] | null // The optional parameters
    isParamSaveLoading: boolean // Whether the parameters are currently being saved
    onOptParamsChange: (
        newOptParams: Parameter[],
        persist: boolean,
        updateVariant: boolean,
        onSuccess?: (isNew: boolean) => void,
    ) => void
    handlePersistVariant: (variantName: string) => void
    isPersistent: boolean
    isParamsCollapsed: string
    setIsParamsCollapsed: (value: string) => void
    environments: Environment[]
    onAdd: () => void
    deleteVariant: (deleteAction?: Function) => void
    getHelpers: (helpers: {save: Function; delete: Function}) => void
    onStateChange: (isDirty: boolean) => void
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
    variant,
    optParams,
    isParamSaveLoading,
    onOptParamsChange,
    handlePersistVariant,
    isPersistent,
    isParamsCollapsed,
    setIsParamsCollapsed,
    environments,
    onAdd,
    deleteVariant,
    getHelpers,
    onStateChange,
}) => {
    const classes = useStyles()
    const [messageApi, contextHolder] = message.useMessage()
    const [isPublishModalOpen, setPublishModalOpen] = useState(false)
    const isVariantExisting = !!variant.variantId

    useEffect(() => {
        onStateChange(variant.persistent === false)
    }, [])

    const onChange = (param: Parameter, newValue: number | string) => {
        handleParamChange(param.name, newValue)
    }
    const handleParamChange = (name: string, newVal: any) => {
        const newOptParams = optParams?.map((param) =>
            param.name === name ? {...param, default: newVal} : param,
        )
        onStateChange(true)
        newOptParams && onOptParamsChange(newOptParams, false, false)
    }

    const onChangeCollapse = (key: string | string[]) => {
        const newValue = Array.isArray(key) && key.includes("1") ? "1" : ""
        setIsParamsCollapsed(newValue)
    }

    const onSave = () => {
        return new Promise((res) => {
            onOptParamsChange(optParams!, true, isPersistent, (isNew: boolean) => {
                if (isNew && onAdd) onAdd()
                messageApi.open({
                    type: "success",
                    content: "Changes saved successfully!",
                    onClose: () => handlePersistVariant(variant.variantName),
                })
                onStateChange(false)
                res(true)
            })
        })
    }

    const handleDelete = () => {
        deleteVariant(() => {
            if (variant.persistent) {
                return removeVariant(variant.variantId).then(() => {
                    onStateChange(false)
                })
            }
        })
    }

    useEffect(() => {
        getHelpers({
            save: onSave,
            delete: handleDelete,
        })
    }, [getHelpers])

    const items: CollapseProps["items"] = [
        {
            key: "1",
            label: (
                <div className={classes.container}>
                    <Row className={classes.row} data-cy="playground-header">
                        <Col span={12}>
                            <h2 className={classes.h2}>1. Modify Parameters</h2>
                        </Col>
                        <Col span={12} className={classes.col}>
                            <Space>
                                {isVariantExisting && (
                                    <Button
                                        onClick={() => setPublishModalOpen(true)}
                                        data-cy="playground-publish-button"
                                    >
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
                                    onClick={onSave}
                                    loading={isParamSaveLoading}
                                    data-cy="playground-save-changes-button"
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
                                    onClick={handleDelete}
                                    data-cy="playground-delete-variant-button"
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
                variant={variant}
                isModalOpen={isPublishModalOpen}
                setIsModalOpen={setPublishModalOpen}
                environments={environments}
            />
        </div>
    )
}
export default ParametersView
