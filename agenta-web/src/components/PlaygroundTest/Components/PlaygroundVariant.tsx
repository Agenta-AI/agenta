import {memo} from "react"
import dynamic from "next/dynamic"
import {Typography} from "antd"
import PlaygroundVariantConfig from "./PlaygroundVariantConfig"
import {type StateVariant} from "../state/types"

const Splitter = dynamic(() => import("antd").then((mod) => mod.Splitter), {ssr: false})
const SplitterPanel = dynamic(() => import("antd").then((mod) => mod.Splitter.Panel), {ssr: false})

const PlaygroundVariant = ({variant}: {variant: StateVariant}) => {
    console.log("render PlaygroundVariant", variant.variantId)
    return (
        <div key={variant.variantId} className="flex flex-col grow h-full overflow-hidden">
            <div className="w-full max-h-full h-full grow relative overflow-hidden">
                <Splitter className="h-full">
                    <SplitterPanel defaultSize="40%" min="20%" max="70%" className="!h-full">
                        <PlaygroundVariantConfig variant={variant} variantId={variant.variantId} />
                    </SplitterPanel>
                    <SplitterPanel className="!h-full">
                        <Typography.Text className="text-[14px] leading-[22px] font-[500]">
                            Generation
                        </Typography.Text>
                    </SplitterPanel>
                </Splitter>
            </div>
        </div>
    )
}

export default memo(PlaygroundVariant)
