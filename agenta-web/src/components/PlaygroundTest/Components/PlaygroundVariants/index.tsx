import {memo} from "react"
import usePlaygroundVariants from "../../hooks/usePlaygroundVariants"
import PlaygroundVariant from "../PlaygroundVariant"

const PlaygroundVariants = memo(() => {
    const {variants} = usePlaygroundVariants()

    console.log("render VariantsWrapper", variants)

    return (
        <div className="flex flex-col gap-2 w-full grow overflow-hidden">
            {variants.map((variant) => {
                return <PlaygroundVariant variant={variant} key={variant.variantId} />
            })}
        </div>
    )
})

export default PlaygroundVariants