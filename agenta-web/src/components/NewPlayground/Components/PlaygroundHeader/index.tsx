import {Typography, message} from "antd"
import clsx from "clsx"
import usePlayground from "../../hooks/usePlayground"

import type {BaseContainerProps} from "../types"
import dynamic from "next/dynamic"
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
    const [, contextHolder] = message.useMessage()

    const {toggleVariantDisplay, displayedVariants, variants} = usePlayground()

    // Only render if variants are available
    return !!variants ? (
        <>
            {contextHolder}
            <div
                className={clsx(
                    "flex items-center justify-between gap-4 px-2.5 py-2",
                    "bg-[#f5f7fa]",
                    className,
                )}
                {...divProps}
            >
                <Typography className="text-[16px] leading-[18px] font-[600]">
                    Playground
                </Typography>

                <PlaygroundCreateNewVariant
                    displayedVariants={displayedVariants}
                    onSelect={toggleVariantDisplay}
                    buttonProps={{label: "Variants"}}
                />
            </div>
        </>
    ) : null
}

export default PlaygroundHeader
