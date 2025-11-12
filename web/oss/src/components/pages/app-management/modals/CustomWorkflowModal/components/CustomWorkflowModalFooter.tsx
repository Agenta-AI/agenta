import {memo} from "react"

import {CheckCircleOutlined, ExclamationCircleOutlined, LinkOutlined} from "@ant-design/icons"
import {Button, notification, Space, Tooltip, Typography} from "antd"

import {isAppNameInputValid} from "@/oss/lib/helpers/utils"

const CustomWorkflowModalFooter = ({
    handleEditCustomUrl,
    testConnectionStatus,
    runTestConnection,
    customWorkflowAppValues,
    configureWorkflow,
    isConfiguringWorkflow,
    appNameExist,
    handleCancelButton,
    handleCreateApp,
    isUrlValid,
    variantsReady,
}: {
    handleEditCustomUrl: () => Promise<void>
    testConnectionStatus: {
        success: boolean
        error: boolean
        loading: boolean
    }
    runTestConnection: (delay?: number, url?: string) => Promise<void>
    customWorkflowAppValues: {
        appName: string
        appUrl: string
        appDesc: string
    }
    appNameExist: boolean | undefined
    configureWorkflow: boolean
    isConfiguringWorkflow: boolean
    handleCreateApp: () => void
    handleCancelButton: () => void
    isUrlValid?: boolean
    variantsReady?: boolean
}) => {
    return (
        <div className="flex items-center justify-between">
            <Space align="center">
                <Button
                    loading={testConnectionStatus.loading}
                    icon={<LinkOutlined />}
                    type="default"
                    onClick={() => runTestConnection(undefined, customWorkflowAppValues.appUrl)}
                    disabled={
                        !customWorkflowAppValues.appUrl ||
                        (typeof isUrlValid === "boolean" && !isUrlValid)
                    }
                    style={{minWidth: 140}}
                    className="whitespace-nowrap"
                >
                    Test connection
                </Button>
                <div style={{minWidth: 120, display: "inline-flex", alignItems: "center", gap: 6}}>
                    {testConnectionStatus.success && (
                        <>
                            <CheckCircleOutlined style={{color: "green"}} />
                            <Typography.Text type="secondary">Success</Typography.Text>
                        </>
                    )}
                    {testConnectionStatus.error && (
                        <>
                            <ExclamationCircleOutlined style={{color: "red"}} />
                            <Typography.Text type="secondary">Failure</Typography.Text>
                        </>
                    )}
                </div>
            </Space>

            {configureWorkflow ? (
                <Space>
                    <Button onClick={handleCancelButton}>Cancel</Button>
                    <Tooltip
                        title={
                            variantsReady === false
                                ? "Loading app variants..."
                                : !customWorkflowAppValues.appUrl
                                  ? "Enter a workflow URL"
                                  : typeof isUrlValid === "boolean" && !isUrlValid
                                    ? "Enter a valid URL (http/https)"
                                    : !testConnectionStatus.success
                                      ? "Please test the connection and ensure a successful response before configuring the app."
                                      : ""
                        }
                    >
                        <Button
                            type="primary"
                            disabled={
                                variantsReady === false ||
                                !customWorkflowAppValues.appUrl ||
                                (typeof isUrlValid === "boolean" && !isUrlValid) ||
                                !testConnectionStatus.success
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
                        !customWorkflowAppValues.appUrl
                            ? "Enter a workflow URL"
                            : typeof isUrlValid === "boolean" && !isUrlValid
                              ? "Enter a valid URL (http/https)"
                              : !testConnectionStatus.success
                                ? "Please test the connection and ensure a successful response before creating the app."
                                : ""
                    }
                >
                    <Button
                        id="tour-create-custom-app-button"
                        type="primary"
                        disabled={
                            !customWorkflowAppValues.appName ||
                            !customWorkflowAppValues.appUrl ||
                            (typeof isUrlValid === "boolean" && !isUrlValid) ||
                            appNameExist ||
                            !isAppNameInputValid(customWorkflowAppValues.appName) ||
                            !testConnectionStatus.success
                        }
                        onClick={() => {
                            if (appNameExist) {
                                notification.warning({
                                    message: "Custom Workflow",
                                    description:
                                        "App name already exists. Please choose a different name.",
                                    duration: 3,
                                })
                            } else if (!isAppNameInputValid(customWorkflowAppValues.appName)) {
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
    )
}

export default memo(CustomWorkflowModalFooter)
