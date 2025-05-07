import clsx from "clsx"

import {GenerationOutputNavigatorProps} from "./types"

const GenerationOutputNavigator = ({className}: GenerationOutputNavigatorProps) => {
    return (
        <nav className={clsx("flex items-center gap-2 h-[48px] bg-[#f5f7fa] px-2", className)}>
            <a href="#">Output</a>
        </nav>
    )
}

export default GenerationOutputNavigator
