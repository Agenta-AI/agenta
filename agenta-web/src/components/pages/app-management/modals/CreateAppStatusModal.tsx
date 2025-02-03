import {GenericObject, JSSTheme} from "@/lib/Types"
import {getErrorMessage} from "@/lib/helpers/errorHandler"
import {Modal, Typography, theme} from "antd"
import {useRouter} from "next/router"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import {Check, CircleNotch, ExclamationMark} from "@phosphor-icons/react"
import CustomAppCreationLoader from "./CustomAppCreationLoader"

const {Text} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    statusRow: {
        display: "flex",
        alignItems: "center",
        gap: 8,
    },
    modal: {
        "& .ant-modal-content": {
            padding: 0,
            overflow: "hidden",
            borderRadius: 16,
            "& > .ant-modal-footer": {
                padding: theme.paddingContentHorizontalLG,
                paddingTop: 0,
            },
        },
    },
    topContainer: {
        wdith: "100%",
        height: 200,
        backgroundColor: "#F5F7FA",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    bottomContainer: {
        padding: theme.paddingContentHorizontalLG,
        display: "grid",
        gap: 10,
    },
    headerText: {
        lineHeight: theme.lineHeightLG,
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightStrong,
    },
    error: {
        color: theme.colorError,
    },
    subText: {
        color: theme.colorTextSecondary,
    },
}))

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
        token: {colorError, cyan5: colorSuccess},
    } = theme.useToken()
    const [messages, setMessages] = useState<{
        [status: string]: {
            type: "error" | "success" | "loading"
            message: string
            errorMessage?: string
        }
    }>({})

    const {appId, status, details} = statusData
    const isError = ["bad_request", "error"].includes(status)
    const isTimeout = status === "timeout"
    const isSuccess = status === "success"
    const closable = isError || isTimeout

    const reset = () => {
        setMessages({})
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
                            message: "Adding application",
                        },
                    }
                    if (obj.fetching_image?.type === "loading") obj.fetching_image.type = "success"
                    return obj
                case "starting_app":
                    obj = {
                        ...prev,
                        [status]: {
                            type: "loading",
                            message: "Starting service (takes ~20s)",
                        },
                    }
                    if (obj.creating_app?.type === "loading") obj.creating_app.type = "success"
                    return obj
                case "success":
                    obj = {
                        ...prev,
                        [status]: {
                            type: "success",
                            message: "Launching your application",
                        },
                    }
                    if (obj.starting_app?.type === "loading") obj.starting_app.type = "success"
                    if (appId) {
                        router.push(`/apps/${appId}/playground`)
                    }
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
    }, [appId, details, router, status])

    return (
        <Modal
            data-cy="create-app-status-modal"
            destroyOnClose
            onOk={onOk}
            okText={"Retry"}
            footer={closable ? undefined : null}
            closable={closable}
            title={null}
            {...props}
            onCancel={closable ? props.onCancel : undefined}
            className={classes.modal}
            width={480}
            centered
        >
            <section>
                <div className={classes.topContainer}>
                    <div>
                        {closable ? (
                            <div className="flex flex-col items-center">
                                <ExclamationMark size={48} className={`${classes.error} mb-2`} />
                                <Text className={classes.subText}>Oops, something went wrong.</Text>
                                <Text className={`${classes.subText} mx-6 text-center`}>
                                    {isError && getErrorMessage(details)}{" "}
                                    {isTimeout &&
                                        'The app took too long to start. Press the "Retry" button if you want to try again.'}
                                </Text>
                            </div>
                        ) : (
                            <CustomAppCreationLoader isFinish={isSuccess} />
                        )}
                    </div>
                </div>

                <div className={classes.bottomContainer}>
                    <Text className={classes.headerText}>Creating your new app</Text>
                    {Object.values(messages).map(({type, message}) => (
                        <div className={classes.statusRow} key={message}>
                            {type === "success" ? (
                                <Check size={16} style={{color: colorSuccess}} />
                            ) : type === "error" ? (
                                <ExclamationMark size={16} style={{color: colorError}} />
                            ) : (
                                <CircleNotch size={16} className="animate-spin" />
                            )}
                            <Text style={{color: type === "error" ? colorError : ""}}>
                                {message}{" "}
                                {message == "Adding application" && (
                                    <span className="font-medium">{appName}</span>
                                )}
                            </Text>
                        </div>
                    ))}
                </div>
            </section>
        </Modal>
    )
}

export default CreateAppStatusModal
