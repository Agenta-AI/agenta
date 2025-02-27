import {ArrowCounterClockwise, X} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"

import DeployButton from "@/oss/components/NewPlayground/assets/DeployButton"
import Version from "@/oss/components/NewPlayground/assets/Version"

import {useStyles} from "../styles"

import {PlaygroundVariantHistoryHeaderProps} from "./types"

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
