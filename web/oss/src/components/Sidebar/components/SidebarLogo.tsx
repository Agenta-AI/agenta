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
        ? "/assets/logos/Agenta-logo-full-dark.svg"
        : "/assets/logos/Agenta-logo-full-light.svg"
    const symbolSrc = isDark
        ? "/assets/logos/Agenta-symbol-dark.svg"
        : "/assets/logos/Agenta-symbol-light.svg"

    return (
        <div
            className={[
                "flex h-[48px] shrink-0 items-center mb-2",
                collapsed ? "justify-center" : "px-3",
            ].join(" ")}
        >
            {collapsed ? (
                <Image src={symbolSrc} alt="Agenta" width={24} height={24} priority />
            ) : (
                <Image src={fullSrc} alt="Agenta" width={90} height={24} priority />
            )}
        </div>
    )
}

export default SidebarLogo
