import {memo} from "react"

import {CheckCircleOutlined, ExclamationCircleOutlined} from "@ant-design/icons"
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
}) => {
    return (
        <div className="flex items-center justify-between">
            <Space>
                <Button
                    loading={testConnectionStatus.loading}
                    type={testConnectionStatus.loading ? "dashed" : "default"}
                    onClick={() => runTestConnection(undefined, customWorkflowAppValues.appUrl)}
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
                    <Button onClick={handleCancelButton}>Cancel</Button>
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
                                !customWorkflowAppValues.appName || !customWorkflowAppValues.appUrl
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
