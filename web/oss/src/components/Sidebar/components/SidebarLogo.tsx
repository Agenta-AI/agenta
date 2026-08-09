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
                "flex h-[48px] shrink-0 items-start pt-2 mb-1",
                collapsed ? "justify-center" : "justify-between pl-2 pr-2",
            )}
        >
            {/* unoptimized: SVGs skip /_next/image, which rejects SVG without dangerouslyAllowSVG. */}
            {/* 99x22 keeps the SVG's intrinsic 361:80 ratio at the 22px brand height. */}
            {!collapsed && (
                <Image src={fullSrc} alt="Agenta" width={99} height={22} priority unoptimized />
            )}
            <SidebarToggleButton />
        </div>
    )
}

export default SidebarLogo
