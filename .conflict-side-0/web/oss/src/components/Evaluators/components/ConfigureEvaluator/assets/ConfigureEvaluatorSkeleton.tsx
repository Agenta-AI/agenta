import {memo} from "react"

import {Divider, Skeleton} from "antd"

const ConfigureEvaluatorSkeleton = () => {
    return (
        <div className="flex h-full gap-4">
            <div className="flex flex-col gap-4 w-[50%]">
                <div className="flex items-center gap-2">
                    <Skeleton.Button active style={{width: 24, height: 24}} />
                    <Skeleton.Input active style={{width: 120, height: 24}} />
                </div>

                <div className="flex flex-col gap-2">
                    <Skeleton.Input active style={{width: 200}} />
                    <Skeleton.Node active style={{width: "100%", height: 50}} />
                </div>

                <div className="flex flex-col gap-2">
                    <Skeleton.Node active style={{width: "100%", height: 120}} />
                    <Skeleton.Node active style={{width: "100%", height: 150}} />
                </div>
            </div>

            <Divider orientation="vertical" className="!h-[85vh]" />

            <div className="flex flex-col gap-4 w-[50%]">
                <div className="flex flex-col gap-2">
                    <Skeleton.Input active style={{width: 120, height: 24}} />
                    <Skeleton.Node active style={{width: "100%", height: 50}} />
                </div>
                <div className="flex flex-col gap-2">
                    <Skeleton.Node active style={{width: "100%", height: 180}} />
                    <Skeleton.Node active style={{width: "100%", height: 180}} />
                    <Skeleton.Node active style={{width: "100%", height: 180}} />
                </div>
            </div>
        </div>
    )
}

export default memo(ConfigureEvaluatorSkeleton)
