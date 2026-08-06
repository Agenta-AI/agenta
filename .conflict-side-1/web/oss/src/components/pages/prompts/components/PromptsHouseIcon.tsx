import React, {useState} from "react"

import {HouseIcon} from "@phosphor-icons/react"

const PromptsHouseIcon = ({active}: {active: boolean}) => {
    const [hovered, setHovered] = useState(false)

    return (
        <span onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
            <HouseIcon size={14} color="#1C2C3D" weight={active || hovered ? "fill" : "regular"} />
        </span>
    )
}

export default PromptsHouseIcon
