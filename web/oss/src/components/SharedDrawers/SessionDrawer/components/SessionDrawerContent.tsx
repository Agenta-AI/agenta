import {useState} from "react"

import {CloseOutlined, FullscreenExitOutlined, FullscreenOutlined} from "@ant-design/icons"
import {Button, Skeleton, Splitter} from "antd"
import dynamic from "next/dynamic"

import {useSessionDrawer} from "../hooks/useSessionDrawer"

const SessionContent = dynamic(
    () => import("@/oss/components/SharedDrawers/SessionDrawer/components/SessionContent"),
)
const SessionHeader = dynamic(
    () => import("@/oss/components/SharedDrawers/SessionDrawer/components/SessionHeader"),
)
const SessionTree = dynamic(
    () => import("@/oss/components/SharedDrawers/SessionDrawer/components/SessionTree"),
)

interface TraceDrawerContentProps {
    onClose: () => void
    onToggleWidth: () => void
    isExpanded: boolean
}

const SessionDrawerContent = ({onClose, onToggleWidth, isExpanded}: TraceDrawerContentProps) => {
    const [selected, setSelected] = useState<string>("")
    const {isLoading, sessionTraces} = useSessionDrawer()
    console.log("sessionTraces", sessionTraces)
    if (isLoading) {
        return (
            <div className="h-full w-full p-4 flex flex-col gap-4">
                <div className="flex justify-between">
                    <Skeleton.Button active size="small" shape="round" />
                    <Skeleton.Button active size="small" shape="round" />
                </div>
                <div className="flex gap-4 h-full">
                    <div className="w-[320px]">
                        <Skeleton active paragraph={{rows: 10}} />
                    </div>
                    <div className="flex-1">
                        <Skeleton active paragraph={{rows: 10}} />
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="h-full w-full flex flex-col">
            <div className="flex items-center gap-3 px-4 py-3 border-0 border-b border-solid border-colorSplit">
                <Button onClick={onClose} type="text" icon={<CloseOutlined />} />
                <Button
                    onClick={onToggleWidth}
                    type="text"
                    icon={isExpanded ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                />
                <div className="flex-1 min-w-0">
                    <SessionHeader />
                </div>
            </div>

            <div className="h-full min-w-0">
                <Splitter>
                    <Splitter.Panel defaultSize={320} collapsible>
                        <SessionTree selected={selected} setSelected={setSelected} />
                    </Splitter.Panel>
                    <Splitter.Panel min={600}>
                        <SessionContent />
                    </Splitter.Panel>
                </Splitter>
            </div>
        </div>
    )
}

export default SessionDrawerContent
