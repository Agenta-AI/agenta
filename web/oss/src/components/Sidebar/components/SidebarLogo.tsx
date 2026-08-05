import {useEffect, useState} from "react"

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
    const [version, setVersion] = useState<string>()

    // Lazy-load package.json so its version stays out of the initial bundle.
    useEffect(() => {
        if (collapsed || version) return
        import("../../../../package.json").then((pkg) => setVersion(pkg.version))
    }, [collapsed, version])

    const fullSrc = isDark
        ? "/assets/logos/Agenta-logo-full-dark-accent.svg"
        : "/assets/logos/Agenta-logo-full-light.svg"

    const toggleButton = (
        <EnhancedButton
            type="text"
            size="small"
            className="shrink-0 !h-[28px]"
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
                collapsed ? "justify-center" : "justify-between pl-3 pr-2",
            )}
        >
            {/* unoptimized: SVGs skip /_next/image, which rejects SVG without dangerouslyAllowSVG. */}
            {!collapsed && (
                <div className="flex items-center gap-1.5">
                    <Image src={fullSrc} alt="Agenta" width={85} height={20} priority unoptimized />
                    {version && (
                        <span className="text-[9px] leading-none text-colorTextTertiary">
                            v{version}
                        </span>
                    )}
                </div>
            )}
            {toggleButton}
        </div>
    )
}

export default SidebarLogo
