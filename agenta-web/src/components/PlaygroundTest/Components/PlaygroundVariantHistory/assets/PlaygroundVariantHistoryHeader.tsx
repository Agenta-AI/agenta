import {Button, Dropdown, Typography} from "antd"
import {useStyles} from "../styles"
import {PlaygroundVariantHistoryHeaderProps} from "./types"
import Version from "../../../assets/Version"
import DeployButton from "../../../assets/DeployButton"
import {
    ArrowCounterClockwise,
    ArrowsOut,
    Copy,
    DotsThreeVertical,
    Rocket,
    X,
} from "@phosphor-icons/react"
import clsx from "clsx"

const PlaygroundVariantHistoryHeader: React.FC<PlaygroundVariantHistoryHeaderProps> = ({
    slectedRevision,
}) => {
    const classes = useStyles()

    return (
        <section
            className={clsx("flex justify-between items-center px-4 py-2", classes.headerContainer)}
        >
            <div className="flex items-center">
                <div className="w-[180px] flex items-center gap-2">
                    <Button icon={<X size={14} />} />
                    <Typography className="text-[16px] leading-[18px] font-[600]">
                        History
                    </Typography>
                </div>
                <Version revision={slectedRevision} />
            </div>

            <div className="flex items-center gap-2">
                <DeployButton label="Deploy" type="primary" />
                <Button icon={<ArrowCounterClockwise size={14} />}>Revert</Button>
                <Dropdown
                    trigger={["click"]}
                    overlayStyle={{width: 170}}
                    menu={{
                        items: [
                            {
                                key: "deploy",
                                label: "Deploy",
                                icon: <Rocket size={14} />,
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

                            {type: "divider"},
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
            </div>
        </section>
    )
}

export default PlaygroundVariantHistoryHeader
