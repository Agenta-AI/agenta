import {useMemo} from "react"
import {Button, Dropdown, MenuProps} from "antd"
import {ArrowsOut, Copy, DotsThreeVertical, Rocket} from "@phosphor-icons/react"
import {PlaygroundVariantHistoryHeaderMenuProps} from "./types"

const PlaygroundVariantHistoryHeaderMenu: React.FC<PlaygroundVariantHistoryHeaderMenuProps> = ({
    ...props
}) => {
    const items: MenuProps["items"] = useMemo(
        () => [
            {
                key: "focus",
                label: "Focus view",
                icon: <ArrowsOut size={14} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                },
            },

            {
                key: "clone",
                label: "Clone",
                icon: <Copy size={16} />,
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

export default PlaygroundVariantHistoryHeaderMenu
