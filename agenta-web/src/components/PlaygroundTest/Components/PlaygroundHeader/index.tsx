import {memo} from "react"
import dynamic from "next/dynamic"
import {Typography} from "antd"
import clsx from "clsx"
import usePlayground from "../../hooks/usePlayground"
import type {BaseContainerProps} from "../types"
const PlaygroundCreateNewVariant = dynamic(() => import("../Menus/PlaygroundCreateNewVariant"), {
    ssr: false,
})

/**
 * PlaygroundHeader manages the creation of new variants in the playground.
 *
 * This component provides UI for adding new variants based on existing templates
 * and handles the state management for the variant creation modal.
 *
 * @component
 * @example
 * ```tsx
 * import { PlaygroundHeader } from './PlaygroundHeader'
 *
 * function App() {
 *   return <PlaygroundHeader />
 * }
 * ```
 */
const PlaygroundHeader: React.FC<BaseContainerProps> = ({className, ...divProps}) => {
    const {variants} = usePlayground()

    // Only render if variants are available
    return !!variants ? (
        <>
            <div
                className={clsx(
                    "flex justify-between items-center gap-4 px-4 py-2 bg-[#F5F7FA]",
                    className,
                )}
                {...divProps}
            >
                <Typography className="text-[16px] leading-[18px] font-[600]">
                    Playground
                </Typography>

                <PlaygroundCreateNewVariant />
            </div>
        </>
    ) : null
}

export default memo(PlaygroundHeader)
