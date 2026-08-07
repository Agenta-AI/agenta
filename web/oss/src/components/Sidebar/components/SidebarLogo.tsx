import clsx from "clsx"
import Image from "next/image"

import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"

import SidebarToggleButton from "./SidebarToggleButton"

interface SidebarLogoProps {
    collapsed: boolean
}

/** Brand header pinned at the top of the main sidebar: logo + toggle expanded, toggle only collapsed. */
const SidebarLogo = ({collapsed}: SidebarLogoProps) => {
    const {appTheme} = useAppTheme()
    const isDark = appTheme === "dark"

    const fullSrc = isDark
        ? "/assets/logos/Agenta-logo-full-dark-accent.svg"
        : "/assets/logos/Agenta-logo-full-light.svg"

    return (
        <div
            className={clsx(
                "flex h-[48px] shrink-0 items-center mb-1",
                collapsed ? "justify-center" : "justify-between pl-[21px] pr-3",
            )}
        >
            {/* unoptimized: SVGs skip /_next/image, which rejects SVG without dangerouslyAllowSVG. */}
            {!collapsed && (
                <Image src={fullSrc} alt="Agenta" width={85} height={20} priority unoptimized />
            )}
            <SidebarToggleButton />
        </div>
    )
}

export default SidebarLogo
