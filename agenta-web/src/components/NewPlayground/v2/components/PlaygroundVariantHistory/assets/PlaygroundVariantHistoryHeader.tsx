import {Button, Typography} from "antd"
import dynamic from "next/dynamic"
import {useStyles} from "../styles"
import {PlaygroundVariantHistoryHeaderProps} from "./types"
import {ArrowCounterClockwise, X} from "@phosphor-icons/react"
import clsx from "clsx"
import DeployButton from "@/components/NewPlayground/assets/DeployButton"
import Version from "@/components/NewPlayground/assets/Version"
const PlaygroundVariantHistoryHeaderMenu = dynamic(
    () => import("../../Menus/PlaygroundVariantHistoryHeaderMenu"),
    {ssr: false},
)

const PlaygroundVariantHistoryHeader: React.FC<PlaygroundVariantHistoryHeaderProps> = ({
    selectedRevision,
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
                <Version revision={selectedRevision} />
            </div>

            <div className="flex items-center gap-2">
                <DeployButton label="Deploy" type="primary" />
                <Button icon={<ArrowCounterClockwise size={14} />}>Revert</Button>

                <PlaygroundVariantHistoryHeaderMenu />
            </div>
        </section>
    )
}

export default PlaygroundVariantHistoryHeader
