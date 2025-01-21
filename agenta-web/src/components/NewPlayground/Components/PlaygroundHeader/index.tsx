import {Typography} from "antd"
import clsx from "clsx"
import usePlayground from "../../hooks/usePlayground"

import type {BaseContainerProps} from "../types"
import dynamic from "next/dynamic"
import {useStyles} from "./styles"
const PlaygroundCreateNewVariant = dynamic(() => import("../Menus/PlaygroundCreateNewVariant"), {
    ssr: false,
})

const PlaygroundHeader: React.FC<BaseContainerProps> = ({className, ...divProps}) => {
    const classes = useStyles()
    const {toggleVariantDisplay, displayedVariants, variants} = usePlayground()

    // Only render if variants are available
    return !!variants ? (
        <>
            <div
                className={clsx(
                    "flex items-center justify-between gap-4 px-2.5 py-2",
                    classes.header,
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
                    buttonProps={{label: "Compare"}}
                />
            </div>
        </>
    ) : null
}

export default PlaygroundHeader
