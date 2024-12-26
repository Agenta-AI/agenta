import {Button, Dropdown} from "antd"
import {
    ArrowCounterClockwise,
    ArrowsOut,
    Copy,
    DotsThreeVertical,
    FloppyDiskBack,
    PencilSimple,
    Rocket,
} from "@phosphor-icons/react"
import {PlaygroundVariantHeaderMenuProps} from "./types"

const PlaygroundVariantHeaderMenu: React.FC<PlaygroundVariantHeaderMenuProps> = ({
    setIsFocusMoodOpen,
    setIsVariantRenameOpen,
    setIsResetModalOpen,
    setIsCommitModalOpen,
    setIsDeployOpen,
}) => {
    return (
        <Dropdown
            trigger={["click"]}
            overlayStyle={{width: 170}}
            menu={{
                items: [
                    {
                        key: "commit",
                        label: "Commit",
                        icon: <FloppyDiskBack size={14} />,
                        onClick: (e) => {
                            e.domEvent.stopPropagation()
                            setIsCommitModalOpen(true)
                        },
                    },
                    {
                        key: "deploy",
                        label: "Deploy",
                        icon: <Rocket size={14} />,
                        onClick: (e) => {
                            e.domEvent.stopPropagation()
                            setIsDeployOpen(true)
                        },
                    },
                    {
                        key: "history",
                        label: "History",
                        icon: <ArrowCounterClockwise size={14} />,
                        onClick: (e) => {
                            e.domEvent.stopPropagation()
                        },
                    },
                    {
                        key: "focus",
                        label: "Focus view",
                        icon: <ArrowsOut size={14} />,
                        onClick: (e) => {
                            e.domEvent.stopPropagation()
                            setIsFocusMoodOpen(true)
                        },
                    },
                    {type: "divider"},
                    {
                        key: "clone",
                        label: "Clone",
                        icon: <Copy size={16} />,
                        onClick: (e) => {
                            e.domEvent.stopPropagation()
                        },
                    },
                    {
                        key: "rename",
                        label: "Rename",
                        icon: <PencilSimple size={16} />,
                        onClick: (e) => {
                            e.domEvent.stopPropagation()
                            setIsVariantRenameOpen(true)
                        },
                    },
                    {type: "divider"},
                    {
                        key: "reset",
                        label: "Reset",
                        onClick: (e) => {
                            e.domEvent.stopPropagation()
                            setIsResetModalOpen(true)
                        },
                    },
                    {
                        key: "close",
                        label: "Close panel",
                        onClick: (e) => {
                            e.domEvent.stopPropagation()
                        },
                    },
                ],
            }}
        >
            <Button icon={<DotsThreeVertical size={14} />} type="text" />
        </Dropdown>
    )
}

export default PlaygroundVariantHeaderMenu
