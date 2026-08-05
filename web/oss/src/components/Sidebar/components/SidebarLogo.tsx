import {EnhancedButton} from "@agenta/ui/components/presentational"
import {Sidebar} from "@phosphor-icons/react"
import clsx from "clsx"
import {useSetAtom} from "jotai"
import Image from "next/image"

import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import {sidebarCollapsedAtom} from "@/oss/lib/atoms/sidebar"

interface SidebarLogoProps {
    collapsed: boolean
}

/** Brand header pinned at the top of the main sidebar: logo + toggle expanded, toggle only collapsed. */
const SidebarLogo = ({collapsed}: SidebarLogoProps) => {
    const {appTheme} = useAppTheme()
    const isDark = appTheme === "dark"
    const setCollapsed = useSetAtom(sidebarCollapsedAtom)

    const fullSrc = isDark
        ? "/assets/logos/Agenta-logo-full-dark-accent.svg"
        : "/assets/logos/Agenta-logo-full-light.svg"

    const toggleButton = (
        <EnhancedButton
            type="text"
            className="shrink-0 !px-2 h-[30px]"
            icon={
                <Sidebar
                    size={14}
                    className={clsx("transition-transform", collapsed ? "rotate-180" : "")}
                />
            }
            onClick={() => setCollapsed((c) => !c)}
            tooltipProps={{
                title: collapsed ? "Expand" : "Collapse",
                mouseEnterDelay: 1,
                placement: "right",
            }}
        />
    )

    return (
        <div
            className={clsx(
                "flex h-[48px] shrink-0 items-center mb-1",
                collapsed ? "justify-center" : "justify-between px-3",
            )}
        >
            {/* unoptimized: SVGs skip /_next/image, which rejects SVG without dangerouslyAllowSVG. */}
            {!collapsed && (
                <Image src={fullSrc} alt="Agenta" width={85} height={20} priority unoptimized />
            )}
            {toggleButton}
        </div>
    )
}

export default SidebarLogo
