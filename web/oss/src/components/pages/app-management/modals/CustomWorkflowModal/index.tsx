import {useCallback, useEffect, useMemo, useState} from "react"

import {CloseOutlined} from "@ant-design/icons"
import {Scroll} from "@phosphor-icons/react"
import {Typography, Space, Button, Modal} from "antd"

import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import {isAppNameInputValid} from "@/oss/lib/helpers/utils"
import {findCustomWorkflowPath, removeTrailingSlash} from "@/oss/lib/shared/variant"
import {updateVariant} from "@/oss/services/app-selector/api"

import {useStyles} from "./assets/styles"
import CustomWorkflowModalFooter from "./components/CustomWorkflowModalFooter"
import {CustomWorkflowModalProps} from "./types"

const {Text} = Typography

const CustomWorkflowModal = ({
    customWorkflowAppValues,
    setCustomWorkflowAppValues,
    handleCreateApp,
    configureWorkflow = false,
    variants,
    allVariantsDataMutate,
    appNameExist,
    mutate,
    ...props
}: CustomWorkflowModalProps) => {
    const classes = useStyles()
    const [testConnectionStatus, setTestConnectionStatus] = useState({
        success: false,
        error: false,
        loading: false,
    })
    const [isConfiguringWorkflow, setIsConfiguringWorkflow] = useState(false)
    const workflowUrlInput = customWorkflowAppValues.appUrl

    const handleEditCustomUrl = useCallback(async () => {
        if (!variants?.length) return

        // Create a map of unique parent variants using their IDs
        const parentVariantsMap = variants.reduce((acc, variant) => {
            const parentVariant = variant._parentVariant
            if (parentVariant && parentVariant.id) {
                // Use the ID as the key to ensure uniqueness
                acc.set(parentVariant.id, parentVariant)
            }
            return acc
        }, new Map())

        // Convert the map values to an array if needed
        const uniqueParentVariants = Array.from(parentVariantsMap.values())

        setIsConfiguringWorkflow(true)
        try {
            await Promise.all(
                uniqueParentVariants.map((variant) => {
                    return updateVariant({
                        serviceUrl: removeTrailingSlash(workflowUrlInput),
                        variantId: variant?.id,
                    })
                }),
            )
            await Promise.all([allVariantsDataMutate?.(), mutate()])
            setCustomWorkflowAppValues((prev) => ({
                ...prev,
                appUrl: workflowUrlInput,
            }))
        } catch (error) {
            console.error("Failed to update variants:", error)
        } finally {
            setIsConfiguringWorkflow(false)
            props.onCancel?.({} as any)
        }
    }, [variants, workflowUrlInput])

    const runTestConnection = useCallback(async (delay = 0, url?: string) => {
        if (!url) return

        setTestConnectionStatus({success: false, error: false, loading: true})

        try {
            if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
            const {status} = (await findCustomWorkflowPath(url, "/health")) || {}
            if (!status) throw new Error("Unable to establish connection")
            setTestConnectionStatus({success: true, error: false, loading: false})
        } catch (error) {
            console.error(error)
            setTestConnectionStatus({success: false, error: true, loading: false})
        }
    }, [])

    useEffect(() => {
        if (workflowUrlInput) {
            const timeout = setTimeout(() => runTestConnection(undefined, workflowUrlInput), 100)
            return () => clearTimeout(timeout)
        }
    }, [workflowUrlInput, runTestConnection])

    useEffect(() => {
        if (props.open) {
            setTestConnectionStatus({
                error: false,
                success: false,
                loading: false,
            })
        }
    }, [props.open])

    const ModalFooter = useMemo(() => {
        return (
            <CustomWorkflowModalFooter
                handleCancelButton={() => props.onCancel?.({} as any)}
                handleCreateApp={handleCreateApp}
                handleEditCustomUrl={handleEditCustomUrl}
                isConfiguringWorkflow={isConfiguringWorkflow}
                configureWorkflow={configureWorkflow}
                customWorkflowAppValues={customWorkflowAppValues}
                testConnectionStatus={testConnectionStatus}
                appNameExist={appNameExist}
                runTestConnection={runTestConnection}
            />
        )
    }, [
        handleCreateApp,
        handleEditCustomUrl,
        isConfiguringWorkflow,
        configureWorkflow,
        customWorkflowAppValues,
        testConnectionStatus,
        appNameExist,
        runTestConnection,
    ])

    return (
        <Modal
            title={null}
            className={classes.modalContainer}
            width={480}
            closeIcon={null}
            centered
            destroyOnHidden
            footer={ModalFooter}
            {...props}
        >
            <section className={classes.modal}>
                <div className="flex items-center justify-between">
                    <Space className={classes.headerText}>
                        {configureWorkflow ? (
                            <Typography.Text>Configure</Typography.Text>
                        ) : (
                            <Typography.Text>Custom workflow</Typography.Text>
                        )}
                    </Space>

                    <Space>
                        {!configureWorkflow && (
                            <Typography.Link
                                href="https://docs.agenta.ai/custom-workflows/quick-start"
                                target="_blank"
                            >
                                <Button
                                    icon={<Scroll size={14} className="mt-[2px]" />}
                                    size="small"
                                >
                                    Tutorial
                                </Button>
                            </Typography.Link>
                        )}
                        <Button
                            onClick={() => props.onCancel?.({} as any)}
                            type="text"
                            icon={<CloseOutlined />}
                        />
                    </Space>
                </div>

                {!configureWorkflow && (
                    <Text>
                        Connect your own AI service to Agenta to use our evaluation tools with your
                        code. Your application will remain on your infrastructure while Agenta
                        communicates with it through the URL you provide.
                    </Text>
                )}

                <div className="space-y-1">
                    <SharedEditor
                        header={<Typography className={classes.label}>App name *</Typography>}
                        initialValue={customWorkflowAppValues.appName}
                        handleChange={(value) =>
                            setCustomWorkflowAppValues((prev) => ({
                                ...prev,
                                appName: value,
                            }))
                        }
                        editorType="border"
                        placeholder="Enter app name"
                        editorClassName={`!border-none !shadow-none px-0 ${appNameExist || (customWorkflowAppValues.appName.length > 0 && !isAppNameInputValid(customWorkflowAppValues.appName)) ? "border-red-500 !border" : ""}`}
                        className="py-1 px-[11px] !w-auto"
                        useAntdInput
                        disabled={configureWorkflow}
                        state={configureWorkflow ? "disabled" : "filled"}
                    />

                    {appNameExist && (
                        <Typography.Text
                            style={{
                                color: "red",
                                fontSize: "12px",
                                marginTop: "2px",
                                display: "block",
                            }}
                        >
                            App name already exists
                        </Typography.Text>
                    )}
                    {customWorkflowAppValues.appName.length > 0 &&
                        !isAppNameInputValid(customWorkflowAppValues.appName) && (
                            <Typography.Text
                                style={{
                                    color: "red",
                                    fontSize: "12px",
                                    marginTop: "2px",
                                    display: "block",
                                }}
                            >
                                App name must contain only letters, numbers, underscore, or dash
                                without any spaces.
                            </Typography.Text>
                        )}
                </div>

                <SharedEditor
                    header={<Typography className={classes.label}>Workflow URL *</Typography>}
                    initialValue={workflowUrlInput}
                    handleChange={(value) =>
                        setCustomWorkflowAppValues((prev) => ({
                            ...prev,
                            appUrl: value,
                        }))
                    }
                    editorType="border"
                    placeholder="Enter workflow URL"
                    editorClassName="!border-none !shadow-none px-0"
                    className="py-1 px-[11px] !w-auto"
                    useAntdInput
                />
            </section>
        </Modal>
    )
}

export default CustomWorkflowModal
