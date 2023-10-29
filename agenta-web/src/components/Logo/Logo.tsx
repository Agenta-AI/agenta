import Image from "next/image"
import {useMemo} from "react"
import {useAppTheme} from "../Layout/ThemeContextProvider"

const LOGOS = {
    dark: {
        complete: "/assets/dark-complete-transparent-CROPPED.png",
        onlyIcon: "/assets/dark-logo.svg",
    },
    light: {
        complete: "/assets/light-complete-transparent-CROPPED.png",
        onlyIcon: "/assets/light-logo.svg",
    },
}

const Logo: React.FC<Partial<React.ComponentProps<typeof Image>> & {isOnlyIconLogo?: boolean}> = (
    props,
) => {
    const {appTheme} = useAppTheme()
    const {isOnlyIconLogo, ...imageProps} = props

    const logoSrc = useMemo(() => LOGOS[appTheme], [appTheme])
    return isOnlyIconLogo ? (
        <Image
            width={45}
            height={51}
            {...imageProps}
            src={logoSrc.onlyIcon}
            style={{marginRight: "-20px"}}
            alt="Agenta Logo"
        />
    ) : (
        <Image width={154.8} height={51} {...imageProps} src={logoSrc.complete} alt="Agenta Logo" />
    )
}

export default Logo
