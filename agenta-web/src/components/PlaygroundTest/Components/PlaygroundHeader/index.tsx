import {Typography, message} from "antd"
import clsx from "clsx"
import usePlayground from "../../hooks/usePlayground"
import VariantsButton from "../VariantsButton"

import type {BaseContainerProps} from "../types"

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

    const {addVariantToDisplay, displayedVariants, variants} = usePlayground()

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
                <VariantsButton
                    displayedVariants={displayedVariants}
                    onSelect={(variant) => {
                        addVariantToDisplay?.(variant)
                    }}
                />
            </div>
        </>
    ) : null
}

export default PlaygroundHeader
