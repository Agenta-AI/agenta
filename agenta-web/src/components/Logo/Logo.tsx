import Image from "next/image"
import {useMemo} from "react"
import {useAppTheme} from "../Layout/ThemeContextProvider"

const LOGOS = {
    dark: "/assets/dark-complete-transparent-CROPPED.png",
    light: "/assets/light-complete-transparent-CROPPED.png",
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
