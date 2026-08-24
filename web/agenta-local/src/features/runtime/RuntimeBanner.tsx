import {CloseCircleOutlined, PoweroffOutlined} from "@ant-design/icons"
import {Alert, Button, Modal, Tag} from "antd"
import {useAtomValue} from "jotai"
import {useState} from "react"

import {localApi} from "@/lib/api/client"
import {runtimeQueryAtom} from "@/lib/state/runtime"

export const RuntimeBanner = () => {
    const runtime = useAtomValue(runtimeQueryAtom)
    const [closing, setClosing] = useState(false)
    const [confirmOpen, setConfirmOpen] = useState(false)

    const quit = async () => {
        setConfirmOpen(false)
        setClosing(true)
        try {
            await localApi.shutdown()
        } catch {
            setClosing(false)
        }
    }

    return (
        <>
            {closing ? (
                <Alert
                    banner
                    showIcon
                    message="Agenta Local is closing. You can close this tab."
                    type="info"
                />
            ) : runtime.isError ? (
                <Alert
                    banner
                    showIcon
                    type="error"
                    message="Local service unavailable"
                    description="The renderer cannot reach the FastAPI service. Check the Agenta Local launcher logs."
                />
            ) : runtime.data && !runtime.data.runner.ok ? (
                <Alert
                    banner
                    showIcon
                    type="warning"
                    message="Agent runner unavailable"
                    description="The app is running, but agent turns cannot start. Check the local runner logs."
                    action={<Tag icon={<CloseCircleOutlined />}>Runner offline</Tag>}
                />
            ) : null}
            <Button
                className="quit-button"
                type="text"
                danger
                icon={<PoweroffOutlined />}
                onClick={() => setConfirmOpen(true)}
            >
                Quit
            </Button>
            <Modal
                title="Quit Agenta Local?"
                open={confirmOpen}
                onCancel={() => setConfirmOpen(false)}
                onOk={() => void quit()}
                okText="Quit application"
                okButtonProps={{danger: true}}
            >
                <p>
                    This stops the local service and agent runner. Your agents and sessions remain
                    saved.
                </p>
            </Modal>
        </>
    )
}
