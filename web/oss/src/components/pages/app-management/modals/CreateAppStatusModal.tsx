import {useEffect} from "react"

import {Check, CircleNotch, ExclamationMark} from "@phosphor-icons/react"
import {Modal, Typography, theme} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import {createUseStyles} from "react-jss"

import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {getErrorMessage} from "@/oss/lib/helpers/errorHandler"
import {JSSTheme} from "@/oss/lib/Types"
import {appCreationMessagesAtom, appCreationNavigationAtom} from "@/oss/state/appCreation/status"
import {resetAppCreationAtom} from "@/oss/state/appCreation/status"
import type {AppCreationStatus} from "@/oss/state/appCreation/status"

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
    statusData: AppCreationStatus
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
    const classes = useStyles()
    const {goToPlayground} = usePlaygroundNavigation()
    const {
        token: {colorError, cyan5: colorSuccess},
    } = theme.useToken()
    const [messages, setMessages] = useAtom(appCreationMessagesAtom)
    const navigationTarget = useAtomValue(appCreationNavigationAtom)
    const setNavigationTarget = useSetAtom(appCreationNavigationAtom)
    const resetAppCreation = useSetAtom(resetAppCreationAtom)

    const {appId, status, details} = statusData
    const isError = ["bad_request", "error", "permission_denied"].includes(status)
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
            if (appId) setNavigationTarget(appId)
        }
    }

    useEffect(() => {
        setMessages((draft) => {
            switch (status) {
                case "creating_app":
                    draft[status] = {
                        type: "loading",
                        message: "Adding application",
                    }
                    if (draft.fetching_image?.type === "loading")
                        draft.fetching_image.type = "success"
                    break
                case "starting_app":
                    draft[status] = {
                        type: "loading",
                        message: "Starting service (takes ~20s)",
                    }
                    if (draft.creating_app?.type === "loading") draft.creating_app.type = "success"
                    break
                case "success":
                    draft[status] = {
                        type: "success",
                        message: "Launching your application",
                    }
                    if (draft.starting_app?.type === "loading") draft.starting_app.type = "success"
                    if (appId) {
                        setNavigationTarget(appId)
                    }
                    break
                case "bad_request":
                case "error":
                case "permission_denied":
                    {
                        const lastStatus = Object.keys(draft).pop() ?? ""
                        if (!lastStatus) break
                        draft[lastStatus] = {
                            ...(draft[lastStatus] ?? {
                                type: "error",
                                message: draft[lastStatus]?.message ?? "",
                            }),
                            type: "error",
                            errorMessage: `${getErrorMessage(details)}`,
                        }
                    }
                    break
                case "timeout":
                    draft.starting_app = {
                        ...(draft.starting_app ?? {
                            type: "error",
                            message: "Starting service (takes ~20s)",
                        }),
                        type: "error",
                        errorMessage:
                            'Error: The app took too long to start. Press the "Retry" button if you want to try again.',
                    }
                    break
                case "cleanup":
                    draft[status] = {
                        type: "loading",
                        message: "Performing cleaning up before retrying",
                    }
                    break
            }
        })
    }, [appId, details, setMessages, setNavigationTarget, status])

    useEffect(() => {
        // Only handle navigation when the status modal is open to prevent
        // unintended redirects when returning to /apps after creation.
        if (!props.open) return
        if (!navigationTarget) return

        const nextAppId = navigationTarget
        setNavigationTarget(null)
        goToPlayground(undefined, {appId: nextAppId})
        // Clear creation state so revisiting /apps doesn't re-trigger navigation
        resetAppCreation()
    }, [props.open, goToPlayground, navigationTarget, setNavigationTarget, resetAppCreation])

    return (
        <Modal
            destroyOnHidden
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
