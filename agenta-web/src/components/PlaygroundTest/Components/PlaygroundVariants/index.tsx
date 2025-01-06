import dynamic from "next/dynamic"
import clsx from "clsx"
import usePlayground from "../../hooks/usePlayground"
import type {BaseContainerProps} from "../types"
import PlaygroundComparisionView from "../PlaygroundComparisionView"

const PlaygroundVariant = dynamic(() => import("../PlaygroundVariant"), {ssr: false})

/**
 * PlaygroundVariants component
 *
 * This component is responsible for rendering a list of playground variants.
 * It uses the `usePlaygroundVariants` hook to fetch the variants and then
 * dynamically imports and renders the `PlaygroundVariant` component for each variant.
 *
 * @returns {JSX.Element} The rendered component.
 */
const PlaygroundVariants = ({className, ...props}: BaseContainerProps) => {
    const {variantIds} = usePlayground({
        hookId: "playgroundVariants",
    })

    console.log(
        "usePlayground[%cComponent%c] - PlaygroundVariants - RENDER!",
        "color: orange",
        "",
        variantIds,
    )

    return (
        <div
            className={clsx(["flex flex-col gap-2 w-full grow overflow-hidden"], className)}
            {...props}
        >
            {/* {(variantIds || []).map((variantId) => {
                return <PlaygroundVariant key={variantId} variantId={variantId} />
            })} */}

            <PlaygroundVariant variantId={variantIds?.[0] as string} />
            {/* <PlaygroundComparisionView variantIds={variantIds as string[]} /> */}
        </div>
    )
}

export default PlaygroundVariants
