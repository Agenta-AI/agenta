import {memo} from "react"

import {DownOutlined} from "@ant-design/icons"
import {Flask, Plus} from "@phosphor-icons/react"
import {Button, Space, Typography} from "antd"
import dynamic from "next/dynamic"

import {useStyles as usePlaygroundHeaderStyles} from "@/oss/components/Playground/Components/PlaygroundHeader/styles"

const PlaygroundLoadingShell = () => {
    const classes = usePlaygroundHeaderStyles()

    return (
        <div className="flex flex-col w-full h-[calc(100dvh-75px)] overflow-hidden">
            <div
                className={`flex items-center justify-between gap-4 px-2.5 py-2 ${classes.header}`}
            >
                <Typography className="text-[16px] leading-[18px] font-[600]">
                    Playground
                </Typography>
                <div className="flex items-center gap-2">
                    <Button
                        type="text"
                        size="small"
                        icon={<Flask size={14} />}
                        className="self-start"
                        disabled
                    >
                        New Evaluation
                    </Button>
                    <Space.Compact size="small">
                        <Button
                            className="flex items-center gap-1"
                            icon={<Plus size={14} />}
                            disabled
                        >
                            Compare
                        </Button>
                        <Button icon={<DownOutlined style={{fontSize: 10}} />} disabled />
                    </Space.Compact>
                </div>
            </div>
        </div>
    )
}

const Playground = dynamic(() => import("../Playground/Playground"), {
    ssr: false,
    loading: PlaygroundLoadingShell,
})

const PlaygroundRouter = () => {
    return <Playground />
}

export default memo(PlaygroundRouter)
