import {GenericObject} from "@/lib/Types"
import {getErrorMessage} from "@/lib/helpers/errorHandler"
import {CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined} from "@ant-design/icons"
import {Alert, Modal, Typography, theme} from "antd"
import {useRouter} from "next/router"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    statusRow: {
        marginTop: 8,
        display: "flex",
        alignItems: "flex-start",
        gap: 8,

        "& .anticon": {
            marginTop: 4,
        },
    },
    warning: {
        margin: "8px 0",
        marginLeft: -2,
    },
    statusSteps: {
        marginTop: 12,
    },
})

interface Props {
    loading: boolean
    onErrorRetry?: () => void
    onTimeoutRetry?: () => void
    statusData: {status: string; details?: any; appId?: string}
    appName: string
}

const CreateAppStatusModal: React.FC<Props & React.ComponentProps<typeof Modal>> = ({
    loading,
    onErrorRetry,
    onTimeoutRetry,
    statusData,
    appName,
    ...props
}) => {
    const router = useRouter()
    const classes = useStyles()
    const {
        token: {colorError, colorSuccess, colorPrimary},
    } = theme.useToken()
    const [messages, setMessages] = useState<{
        [status: string]: {
            type: "error" | "success" | "loading"
            message: string
            errorMessage?: string
        }
    }>({})
    const [isDelayed, setIsDelayed] = useState(false)

    const {appId, status, details} = statusData
    const isError = ["bad_request", "error"].includes(status)
    const isTimeout = status === "timeout"
    const isSuccess = status === "success"
    const closable = isError || isTimeout || isSuccess

    const reset = () => {
        setMessages({})
        setIsDelayed(false)
    }

    const onOk = (e: any) => {
        reset()
        if (isError) {
            onErrorRetry?.()
        } else if (isTimeout) {
            onTimeoutRetry?.()
        } else if (isSuccess) {
            props.onCancel?.(e)
            if (appId) router.push(`/apps/${appId}/playground`)
        }
    }

    useEffect(() => {
        setMessages((prev) => {
            let obj: GenericObject
            switch (status) {
                case "creating_app":
                    obj = {
                        ...prev,
                        [status]: {
                            type: "loading",
                            message: "Creating variant from template image",
                        },
                    }
                    if (obj.fetching_image?.type === "loading") obj.fetching_image.type = "success"
                    return obj
                case "starting_app":
                    obj = {
                        ...prev,
                        [status]: {
                            type: "loading",
                            message: "Waiting for the app to start",
                        },
                    }
                    if (obj.creating_app?.type === "loading") obj.creating_app.type = "success"
                    return obj
                case "success":
                    obj = {
                        ...prev,
                        [status]: {
                            type: "success",
                            message: "App created successfully!",
                        },
                    }
                    if (obj.starting_app?.type === "loading") obj.starting_app.type = "success"
                    return obj
                case "bad_request":
                case "error":
                    const lastStatus = Object.keys(prev).pop() ?? ""
                    return {
                        ...prev,
                        [lastStatus]: {
                            ...prev[lastStatus],
                            type: "error",
                            errorMessage: `Error: ${getErrorMessage(details)}`,
                        },
                    }
                case "timeout":
                    return {
                        ...prev,
                        starting_app: {
                            ...prev.starting_app,
                            type: "error",
                            errorMessage: `Error: The app took too long to start. Press the "Retry" button if you want to try again.`,
                        },
                    }
                case "cleanup":
                    return {
                        ...prev,
                        [status]: {
                            type: "loading",
                            message: "Performing cleaning up before retrying",
                        },
                    }
            }
            return prev
        })
    }, [status])

    useEffect(() => {
        if (!props.open) reset()
        else {
            const timeout = setTimeout(() => {
                setIsDelayed(true)
            }, 20000)
            return () => clearTimeout(timeout)
        }
    }, [props.open])

    return (
        <Modal
            data-cy="create-app-status-modal"
            destroyOnClose
            onOk={onOk}
            okText={isError || isTimeout ? "Retry" : "Go to App"}
            footer={closable ? undefined : null}
            closable={closable}
            title="App Creation Status"
            {...props}
            onCancel={closable ? props.onCancel : undefined}
        >
            {!closable && isDelayed && (
                <Alert
                    className={classes.warning}
                    message="This is taking longer than usual. Please be patient."
                    type="warning"
                    showIcon
                />
            )}
            <Typography.Text>
                Creating your app <strong>"{appName}"</strong>. This can take upto a minute.
            </Typography.Text>

            <div className={classes.statusSteps}>
                {Object.values(messages).map(({type, message, errorMessage}, ix) => (
                    <div className={classes.statusRow} key={message}>
                        {type === "success" ? (
                            <CheckCircleOutlined style={{color: colorSuccess}} />
                        ) : type === "error" ? (
                            <CloseCircleOutlined style={{color: colorError}} />
                        ) : (
                            <LoadingOutlined style={{color: colorPrimary}} />
                        )}
                        <Typography.Text
                            type={
                                type === "success"
                                    ? "success"
                                    : type === "error"
                                    ? "danger"
                                    : "secondary"
                            }
                            strong={Object.keys(messages)[ix] === "success"}
                        >
                            {message}
                            {errorMessage && (
                                <>
                                    <br />
                                    {errorMessage}
                                </>
                            )}
                        </Typography.Text>
                    </div>
                ))}
            </div>
        </Modal>
    )
}

export default CreateAppStatusModal
