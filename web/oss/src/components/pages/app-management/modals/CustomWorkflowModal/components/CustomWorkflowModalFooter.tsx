import {memo} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {Tooltip, TooltipTrigger, TooltipContent} from "@agenta/primitive-ui/components/tooltip"
import {CheckCircleOutlined, ExclamationCircleOutlined, LinkOutlined} from "@ant-design/icons"
import {notification, Space} from "antd"

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
                    onClick={() => runTestConnection(undefined, customWorkflowAppValues.appUrl)}
                    disabled={
                        !customWorkflowAppValues.appUrl ||
                        (typeof isUrlValid === "boolean" && !isUrlValid) ||
                        testConnectionStatus.loading
                    }
                    style={{minWidth: 140}}
                    className="whitespace-nowrap"
                    variant="outline"
                >
                    {testConnectionStatus.loading ? <Spinner /> : null}
                    {<LinkOutlined />}
                    Test connection
                </Button>
                <div style={{minWidth: 120, display: "inline-flex", alignItems: "center", gap: 6}}>
                    {testConnectionStatus.success && (
                        <>
                            <CheckCircleOutlined style={{color: "green"}} />
                            <span className="text-muted-foreground">Success</span>
                        </>
                    )}
                    {testConnectionStatus.error && (
                        <>
                            <ExclamationCircleOutlined style={{color: "red"}} />
                            <span className="text-muted-foreground">Failure</span>
                        </>
                    )}
                </div>
            </Space>

            {configureWorkflow ? (
                <Space>
                    <Button onClick={handleCancelButton} variant="outline">
                        Cancel
                    </Button>
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    disabled={
                                        variantsReady === false ||
                                        !customWorkflowAppValues.appUrl ||
                                        (typeof isUrlValid === "boolean" && !isUrlValid) ||
                                        !testConnectionStatus.success ||
                                        isConfiguringWorkflow
                                    }
                                    onClick={handleEditCustomUrl}
                                >
                                    {isConfiguringWorkflow ? <Spinner /> : null}
                                    Save
                                </Button>
                            }
                        />
                        <TooltipContent>
                            {variantsReady === false
                                ? "Loading app variants..."
                                : !customWorkflowAppValues.appUrl
                                  ? "Enter a workflow URL"
                                  : typeof isUrlValid === "boolean" && !isUrlValid
                                    ? "Enter a valid URL (http/https)"
                                    : !testConnectionStatus.success
                                      ? "Please test the connection and ensure a successful response before configuring the app."
                                      : ""}
                        </TooltipContent>
                    </Tooltip>
                </Space>
            ) : (
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                disabled={
                                    !customWorkflowAppValues.appName ||
                                    !customWorkflowAppValues.appUrl ||
                                    (typeof isUrlValid === "boolean" && !isUrlValid) ||
                                    appNameExist ||
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
                                    } else {
                                        handleCreateApp()
                                    }
                                }}
                            >
                                Create new app
                            </Button>
                        }
                    />
                    <TooltipContent>
                        {!customWorkflowAppValues.appUrl
                            ? "Enter a workflow URL"
                            : typeof isUrlValid === "boolean" && !isUrlValid
                              ? "Enter a valid URL (http/https)"
                              : !testConnectionStatus.success
                                ? "Please test the connection and ensure a successful response before creating the app."
                                : ""}
                    </TooltipContent>
                </Tooltip>
            )}
        </div>
    )
}

export default memo(CustomWorkflowModalFooter)
