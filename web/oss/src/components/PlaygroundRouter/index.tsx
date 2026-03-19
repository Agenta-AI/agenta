import {memo, useMemo} from "react"

import {DownOutlined} from "@ant-design/icons"
import {Flask, Plus} from "@phosphor-icons/react"
import {Button, Space, Typography} from "antd"
import {atom, useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import CustomWorkflowBanner from "@/oss/components/CustomWorkflow/CustomWorkflowBanner"
import {useStyles as usePlaygroundHeaderStyles} from "@/oss/components/Playground/Components/PlaygroundHeader/styles"
import {appsQueryAtom, routerAppIdAtom, recentAppIdAtom} from "@/oss/state/app/atoms/fetcher"

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
    const shouldRender = useAtomValue(
        useMemo(
            () =>
                atom<boolean>((get) => {
                    const appId = get(routerAppIdAtom) || get(recentAppIdAtom)
                    const q: any = get(appsQueryAtom)
                    const isPending = Boolean(q?.isPending)
                    const data: any[] = (q?.data as any) ?? []
                    const app = appId ? data.find((item: any) => item.app_id === appId) : null

                    if (isPending) return true
                    const isInvalid =
                        app && (!app.app_type || String(app.app_type).includes(" (old)"))
                    if (isInvalid) return false
                    return true
                }),
            [],
        ),
    )
    if (!shouldRender)
        return (
            <div className="w-full h-[calc(100dvh-75px)] flex items-center justify-center grow">
                <CustomWorkflowBanner showInPlayground layout="card" />
            </div>
        )
    return <Playground />
}

export default memo(PlaygroundRouter)
