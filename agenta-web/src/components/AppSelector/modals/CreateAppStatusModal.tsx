import {GenericObject} from "@/lib/Types"
import {getErrorMessage} from "@/lib/helpers/errorHandler"
import {CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined} from "@ant-design/icons"
import {Modal, Typography, theme} from "antd"
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
    const [messages, setMessages] = useState<{
        [status: string]: {
            type: "error" | "success" | "loading"
            message: string
            errorMessage?: string
        }
    }>({})
    const classes = useStyles()

    const {appId, status, details} = statusData
    const isError = ["bad_request", "error"].includes(status)
    const isTimeout = status === "timeout"
    const isSuccess = status === "success"

    useEffect(() => {
        setMessages((prev) => {
            let obj: GenericObject
            switch (status) {
                case "fetching_image":
                    obj = {
                        ...prev,
                        [status]: {
                            type: "loading",
                            message: "Fetching image from template",
                        },
                    }
                    if (obj.cleanup?.type === "loading") obj.cleanup.type = "success"
                    return obj
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
        if (!props.open) setMessages({})
    }, [props.open])

    const onOk = (e: any) => {
        setMessages({})
        if (isError) {
            onErrorRetry?.()
        } else if (isTimeout) {
            onTimeoutRetry?.()
        } else if (isSuccess) {
            props.onCancel?.(e)
            if (appId) router.push(`/apps/${appId}/playground`)
        }
    }

    const {
        token: {colorError, colorSuccess, colorPrimary},
    } = theme.useToken()

    return (
        <Modal
            destroyOnClose
            onOk={onOk}
            okText={isError || isTimeout ? "Retry" : "Go to App"}
            footer={isError || isTimeout || isSuccess ? undefined : null}
            closable={false}
            title="Creating New App"
            {...props}
        >
            <Typography.Text>
                Creating your app <strong>{appName}</strong> from template. This may take upto a
                minute. Please wait...
            </Typography.Text>
            {Object.values(messages).map(({type, message, errorMessage}) => (
                <div className={classes.statusRow}>
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
        </Modal>
    )
}

export default CreateAppStatusModal
