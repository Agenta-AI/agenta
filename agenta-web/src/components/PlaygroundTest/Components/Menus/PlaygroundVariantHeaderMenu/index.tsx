import {useMemo} from "react"
import {Button, Dropdown, MenuProps} from "antd"
import {
    ArrowCounterClockwise,
    ArrowsOut,
    Copy,
    DotsThreeVertical,
    FloppyDiskBack,
    PencilSimple,
    Rocket,
    Trash,
} from "@phosphor-icons/react"
import {PlaygroundVariantHeaderMenuProps} from "./types"

const PlaygroundVariantHeaderMenu: React.FC<PlaygroundVariantHeaderMenuProps> = ({
    setIsFocusMoodOpen,
    setIsVariantRenameOpen,
    setIsResetModalOpen,
    setIsCommitModalOpen,
    setIsDeployOpen,
    setIsDeleteVariantModalOpen,
    ...props
}) => {
    const items: MenuProps["items"] = useMemo(
        () => [
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
                key: "rename",
                label: "Rename",
                icon: <PencilSimple size={16} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    setIsVariantRenameOpen(true)
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
                key: "delete",
                danger: true,
                label: "Delete",
                icon: <Trash size={16} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    setIsDeleteVariantModalOpen(true)
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
        [],
    )

    return (
        <Dropdown trigger={["click"]} overlayStyle={{width: 170}} menu={{items}} {...props}>
            <Button icon={<DotsThreeVertical size={14} />} type="text" />
        </Dropdown>
    )
}

export default PlaygroundVariantHeaderMenu
