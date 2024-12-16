import {memo} from "react"
import usePlaygroundVariants from "../../hooks/usePlaygroundVariants"
import dynamic from "next/dynamic"

const PlaygroundVariant = dynamic(() => import("../PlaygroundVariant"), {ssr: false})

const PlaygroundVariants = () => {
    const {variants} = usePlaygroundVariants()

    console.log("render VariantsWrapper", variants)

    return (
        <div className="flex flex-col gap-2 w-full grow overflow-hidden">
            {variants.map((variant) => {
                return <PlaygroundVariant variant={variant} key={variant.variantId} />
            })}
        </div>
    )
}

export default memo(PlaygroundVariants)