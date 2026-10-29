import {useState} from "react"

import {RegionSelector} from "@agenta/auth-ui"

import RegionInfoModal from "./RegionInfoModal"

/** OSS binding: the package's selector, with "Learn more" opening the antd modal. */
const DesktopRegionSelector = () => {
    const [isInfoOpen, setIsInfoOpen] = useState(false)

    return (
        <>
            <RegionSelector onLearnMore={() => setIsInfoOpen(true)} />
            <RegionInfoModal open={isInfoOpen} onClose={() => setIsInfoOpen(false)} />
        </>
    )
}

export default DesktopRegionSelector
