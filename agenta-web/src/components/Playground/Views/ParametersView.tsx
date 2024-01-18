import {Environment, Parameter, Variant} from "@/lib/Types"
import type {CollapseProps} from "antd"
import {Button, Col, Collapse, Row, Space, Tooltip, message} from "antd"
import React, {useContext, useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import {ModelParameters, ObjectParameters, StringParameters} from "./ParametersCards"
import PublishVariantModal from "./PublishVariantModal"
import {promptVersioning, removeVariant} from "@/lib/services/api"
import {CloudUploadOutlined, DeleteOutlined, HistoryOutlined, SaveOutlined} from "@ant-design/icons"
import {usePostHogAg} from "@/hooks/usePostHogAg"
import {PromptVersioningContext} from "../PromptVersioningProvider"

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
    deleteVariant: (deleteAction?: Function) => void
    getHelpers: (helpers: {save: Function; delete: Function}) => void
    onStateChange: (isDirty: boolean) => void
    compareMode: boolean
    tabID: React.MutableRefObject<string>
}

const useStyles = createUseStyles({
    container: {
        width: "100%",
    },
    row: {
        marginTop: 16,
        marginBottom: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
    h2: {
        padding: "0px",
        margin: "0px",
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
    deleteVariant,
    getHelpers,
    onStateChange,
    compareMode,
    tabID,
}) => {
    const classes = useStyles()
    const posthog = usePostHogAg()
    const [messageApi, contextHolder] = message.useMessage()
    const [isPublishModalOpen, setPublishModalOpen] = useState(false)
    const isVariantExisting = !!variant.variantId

    const {setPromptRevisions, setIsDrawerOpen, setHistoryStatus} =
        useContext(PromptVersioningContext)

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
            onOptParamsChange(optParams!, true, isPersistent, () => {
                messageApi.open({
                    type: "success",
                    content: "Changes saved successfully!",
                    onClose: () => handlePersistVariant(variant.variantName),
                })
                onStateChange(false)
                res(true)
            })
            posthog.capture("variant_saved", {variant_id: variant.variantId})
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
    }, [getHelpers, onSave, handleDelete])

    const handleHistoryBtn = async () => {
        setHistoryStatus({loading: true, error: false})
        setIsDrawerOpen(true)
        try {
            const revisions = await promptVersioning(variant.variantId)
            setPromptRevisions(revisions)
            setHistoryStatus({loading: false, error: false})
        } catch (error) {
            setHistoryStatus({loading: false, error: true})
        }
    }

    const items: CollapseProps["items"] = [
        {
            key: "1",
            label: (
                <div className={classes.container}>
                    <Row className={classes.row} data-cy="playground-header">
                        <Col>
                            <h2 className={classes.h2}>1. Modify Parameters</h2>
                        </Col>
                        <Col>
                            <Space>
                                {isVariantExisting && (
                                    <Tooltip
                                        placement="bottom"
                                        title="Publish the variant to different environments"
                                    >
                                        <Button
                                            onClick={() => setPublishModalOpen(true)}
                                            data-cy="playground-publish-button"
                                            icon={compareMode && <CloudUploadOutlined />}
                                        >
                                            {compareMode ? null : "Publish"}
                                        </Button>
                                    </Tooltip>
                                )}

                                <Tooltip>
                                    <Button
                                        onClick={handleHistoryBtn}
                                        data-cy="history-button"
                                        type="link"
                                        icon={compareMode && <HistoryOutlined />}
                                        style={{backgroundColor: "#fa8c16", color: "#fff"}}
                                    >
                                        {compareMode ? null : "History"}
                                    </Button>
                                </Tooltip>

                                <Tooltip
                                    placement="bottom"
                                    title="Save the new parameters for the variant permanently"
                                >
                                    <Button
                                        type="primary"
                                        onClick={onSave}
                                        loading={isParamSaveLoading}
                                        data-cy="playground-save-changes-button"
                                        icon={compareMode && <SaveOutlined />}
                                    >
                                        {compareMode ? null : "Save changes"}
                                    </Button>
                                </Tooltip>

                                <Tooltip placement="bottom" title="Delete the variant permanently">
                                    <Button
                                        type="primary"
                                        danger
                                        onClick={() => {
                                            handleDelete()
                                            tabID.current = variant.variantId
                                        }}
                                        data-cy="playground-delete-variant-button"
                                        icon={compareMode && <DeleteOutlined />}
                                    >
                                        {compareMode ? null : "Delete Variant"}
                                    </Button>
                                </Tooltip>
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
