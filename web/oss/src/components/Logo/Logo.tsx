import {useMemo} from "react"

import Image from "next/image"

import {useAppTheme} from "../Layout/ThemeContextProvider"

const LOGOS = {
    dark: "/assets/Agenta-logo-full-dark-accent.png",
    light: "/assets/Agenta-logo-full-light.png",
}

const Logo: React.FC<Partial<React.ComponentProps<typeof Image>> & {isOnlyIconLogo?: boolean}> = (
    props,
) => {
    const {appTheme} = useAppTheme()
    const {isOnlyIconLogo, ...imageProps} = props

    const logoSrc = useMemo(() => LOGOS[appTheme], [appTheme])

    return <Image {...imageProps} src={logoSrc} alt="Agenta Logo" width={154.8} height={51} />
}

export default Logo
