import Image from "next/image"

import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"

interface SidebarLogoProps {
    collapsed: boolean
}

/** Brand header pinned at the top of the main sidebar: full wordmark expanded, symbol collapsed. */
const SidebarLogo = ({collapsed}: SidebarLogoProps) => {
    const {appTheme} = useAppTheme()
    const isDark = appTheme === "dark"

    const fullSrc = isDark
        ? "/assets/logos/Agenta-logo-full-dark-accent.svg"
        : "/assets/logos/Agenta-logo-full-light.svg"
    const symbolSrc = isDark
        ? "/assets/logos/Agenta-symbol-dark-accent.svg"
        : "/assets/logos/Agenta-symbol-light.svg"

    return (
        <div
            className={[
                "flex h-[48px] shrink-0 items-center mb-1",
                collapsed ? "justify-center" : "px-3",
            ].join(" ")}
        >
            {/* unoptimized: SVGs skip /_next/image, which rejects SVG without dangerouslyAllowSVG. */}
            {collapsed ? (
                <Image src={symbolSrc} alt="Agenta" width={20} height={20} priority unoptimized />
            ) : (
                <Image src={fullSrc} alt="Agenta" width={85} height={20} priority unoptimized />
            )}
        </div>
    )
}

export default SidebarLogo
