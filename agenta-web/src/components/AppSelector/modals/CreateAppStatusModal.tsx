import {GenericObject, JSSTheme} from "@/lib/Types"
import {getErrorMessage} from "@/lib/helpers/errorHandler"
import {Alert, Modal, Typography, theme} from "antd"
import {useRouter} from "next/router"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import {Check, CircleNotch, ExclamationMark} from "@phosphor-icons/react"
import CustomAppCreationLoader from "./CustomAppCreationLoader"

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
    text: {
        display: "flex",
        alignItems: "center",
        color: theme.colorTextTertiary,
        gap: 12,
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
        token: {colorError, colorSuccess = "#36CFC9", colorPrimary},
    } = theme.useToken()
    const [messages, setMessages] = useState<{
        [status: string]: {
            type: "error" | "success" | "loading"
            message: string
        }
    }>({})
    const [isDelayed, setIsDelayed] = useState(false)

    const {appId, status, details} = statusData
    const isError = ["bad_request", "error"].includes(status)
    const isTimeout = status === "timeout"
    const isSuccess = status === "success"
    const closable = isError || isTimeout

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
                            message: `Adding application ${appName}`,
                        },
                    }
                    if (obj.fetching_image?.type === "loading") obj.fetching_image.type = "success"
                    return obj
                case "starting_app":
                    obj = {
                        ...prev,
                        [status]: {
                            type: "loading",
                            message: "Adding template data",
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
                    if (appId) router.push(`/apps/${appId}/playground`)
                    return obj
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
                                <Typography.Text className={classes.subText}>
                                    Oops, something went wrong.
                                </Typography.Text>
                                <Typography.Text className={`${classes.subText} mx-5 text-center`}>
                                    {isError && getErrorMessage(details)}{" "}
                                    {isTimeout &&
                                        'The app took too long to start. Press the "Retry" button if you want to try again.'}
                                </Typography.Text>
                            </div>
                        ) : (
                            <CustomAppCreationLoader isFinish={isSuccess} />
                        )}
                    </div>
                </div>

                <div className={classes.bottomContainer}>
                    <Typography.Text className={classes.headerText}>
                        Creating your new app
                    </Typography.Text>
                    {Object.values(messages).map(({type, message}) => (
                        <div className={classes.statusRow} key={message}>
                            {type === "success" ? (
                                <Check size={16} style={{color: "#36CFC9"}} />
                            ) : type === "error" ? (
                                <ExclamationMark size={16} style={{color: colorError}} />
                            ) : (
                                <CircleNotch size={16} className="animate-spin" />
                            )}
                            <Typography.Text
                                color={
                                    type === "success"
                                        ? "#36CFC9"
                                        : type === "error"
                                          ? colorError
                                          : colorPrimary
                                }
                            >
                                {message}
                            </Typography.Text>
                        </div>
                    ))}
                </div>
            </section>
        </Modal>
    )
}

export default CreateAppStatusModal
