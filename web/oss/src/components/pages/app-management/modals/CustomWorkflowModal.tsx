import {Dispatch, SetStateAction, useCallback, useEffect, useState} from "react"

import {CheckCircleOutlined, CloseOutlined, ExclamationCircleOutlined} from "@ant-design/icons"
import {Scroll} from "@phosphor-icons/react"
import {Typography, Space, Button, Modal, Tooltip, notification} from "antd"
import {createUseStyles} from "react-jss"
import {KeyedMutator} from "swr"

import SharedEditor from "@/oss/components/NewPlayground/Components/SharedEditor"
import {isAppNameInputValid} from "@/oss/lib/helpers/utils"
import {JSSTheme, Variant} from "@/oss/lib/Types"
import {checkServiceHealth, updateVariant} from "@/oss/services/app-selector/api"

const {Text} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    modalContainer: {
        transition: "width 0.3s ease",
        "& .ant-modal-content": {
            overflow: "hidden",
            borderRadius: 16,
            "& > .ant-modal-close": {
                top: 16,
            },
        },
        "& .ant-modal-footer": {
            marginTop: 24,
        },
    },
    modal: {
        display: "flex",
        flexDirection: "column",
        gap: 24,
    },
    headerText: {
        "& .ant-typography": {
            lineHeight: theme.lineHeightLG,
            fontSize: theme.fontSizeHeading4,
            fontWeight: theme.fontWeightStrong,
        },
    },
    label: {
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeight,
    },
}))

type Props = {
    customWorkflowAppValues: {
        appName: string
        appUrl: string
        appDesc: string
    }
    setCustomWorkflowAppValues: Dispatch<
        SetStateAction<{
            appName: string
            appUrl: string
            appDesc: string
        }>
    >
    handleCreateApp: () => void
    configureWorkflow?: boolean
    variants?: any[]
    allVariantsDataMutate?: KeyedMutator<Variant[]>
    fetchVariantsMutate?: () => void
    mutate: () => Promise<any>
    appNameExist?: boolean
} & React.ComponentProps<typeof Modal>

/**
 *
 * TODO: @bekossy
 * - split styles / types / component into different files
 * - create a reuseable hook, so we won't have to duplicate code whenever we want to
 * use this modal
 */

const CustomWorkflowModal = ({
    customWorkflowAppValues,
    setCustomWorkflowAppValues,
    handleCreateApp,
    configureWorkflow = false,
    variants,
    allVariantsDataMutate,
    fetchVariantsMutate,
    appNameExist,
    mutate,
    ...props
}: Props) => {
    const classes = useStyles()
    const [testConnectionStatus, setTestConnectionStatus] = useState({
        success: false,
        error: false,
        loading: false,
    })
    const [isConfiguringWorkflow, setIsConfiguringWorkflow] = useState(false)

    const handleEditCustomUrl = useCallback(async () => {
        if (!variants?.length) return

        setIsConfiguringWorkflow(true)
        try {
            await Promise.all(
                variants.map((variant) =>
                    updateVariant({
                        serviceUrl: customWorkflowAppValues.appUrl,
                        variantId: variant?.variantId ?? variant.id,
                    }),
                ),
            )
            await Promise.all([fetchVariantsMutate?.(), allVariantsDataMutate?.(), mutate?.()])
        } catch (error) {
            console.error("Failed to update variants:", error)
        } finally {
            setIsConfiguringWorkflow(false)
            props.onCancel?.({} as any)
        }
    }, [variants, customWorkflowAppValues.appUrl])

    const runTestConnection = async (delay = 0) => {
        if (!customWorkflowAppValues.appUrl) return

        setTestConnectionStatus({success: false, error: false, loading: true})

        try {
            if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
            await checkServiceHealth({url: customWorkflowAppValues.appUrl})
            setTestConnectionStatus({success: true, error: false, loading: false})
        } catch (error) {
            console.error(error)
            setTestConnectionStatus({success: false, error: true, loading: false})
        }
    }

    useEffect(() => {
        if (customWorkflowAppValues.appUrl) {
            const timeout = setTimeout(() => runTestConnection(), 1000)
            return () => clearTimeout(timeout)
        }
    }, [customWorkflowAppValues.appUrl])

    useEffect(() => {
        if (props.open) {
            setTestConnectionStatus({
                error: false,
                success: false,
                loading: false,
            })
        }
    }, [props.open])

    return (
        <Modal
            title={null}
            className={classes.modalContainer}
            width={480}
            closeIcon={null}
            centered
            destroyOnClose
            footer={
                <div className="flex items-center justify-between">
                    <Space>
                        <Button
                            loading={testConnectionStatus.loading}
                            type={testConnectionStatus.loading ? "dashed" : "default"}
                            onClick={() => runTestConnection()}
                            disabled={!customWorkflowAppValues.appUrl}
                        >
                            {testConnectionStatus.loading ? "Testing" : "Test connection"}
                        </Button>
                        {testConnectionStatus.success && (
                            <>
                                <CheckCircleOutlined style={{color: "green"}} />
                                <Typography.Text type="secondary">Successful</Typography.Text>
                            </>
                        )}
                        {testConnectionStatus.error && (
                            <>
                                <ExclamationCircleOutlined style={{color: "red"}} />
                                <Typography.Text type="secondary">Failed</Typography.Text>
                            </>
                        )}
                    </Space>

                    {configureWorkflow ? (
                        <Space>
                            <Button onClick={() => props.onCancel?.({} as any)}>Cancel</Button>
                            <Tooltip
                                title={
                                    !testConnectionStatus.success
                                        ? "Please test the connection and ensure a successful response before configuring the app."
                                        : ""
                                }
                            >
                                <Button
                                    type="primary"
                                    disabled={
                                        !customWorkflowAppValues.appName ||
                                        !customWorkflowAppValues.appUrl
                                        // !testConnectionStatus.success
                                    }
                                    onClick={handleEditCustomUrl}
                                    loading={isConfiguringWorkflow}
                                >
                                    Save
                                </Button>
                            </Tooltip>
                        </Space>
                    ) : (
                        <Tooltip
                            title={
                                !testConnectionStatus.success
                                    ? "Please test the connection and ensure a successful response before creating the app."
                                    : ""
                            }
                        >
                            <Button
                                type="primary"
                                disabled={
                                    !customWorkflowAppValues.appName ||
                                    !customWorkflowAppValues.appUrl ||
                                    appNameExist ||
                                    !isAppNameInputValid(customWorkflowAppValues.appName)
                                    // !testConnectionStatus.success
                                }
                                onClick={() => {
                                    if (appNameExist) {
                                        notification.warning({
                                            message: "Custom Workflow",
                                            description:
                                                "App name already exists. Please choose a different name.",
                                            duration: 3,
                                        })
                                    } else if (
                                        !isAppNameInputValid(customWorkflowAppValues.appName)
                                    ) {
                                        notification.warning({
                                            message: "Custom Workflow",
                                            description: "Please provide a valid app name.",
                                            duration: 3,
                                        })
                                    } else {
                                        handleCreateApp()
                                    }
                                }}
                            >
                                Create new app
                            </Button>
                        </Tooltip>
                    )}
                </div>
            }
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
                    initialValue={customWorkflowAppValues.appUrl}
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
