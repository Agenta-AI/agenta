import {useState} from "react"

import {CloseOutlined, FullscreenExitOutlined, FullscreenOutlined} from "@ant-design/icons"
import {Button, Splitter} from "antd"
import dynamic from "next/dynamic"

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
