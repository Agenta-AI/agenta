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

    return (
        <div
            className={`overflow-hidden h-[51px] transition-width duration-300 ease-in-out ${
                isOnlyIconLogo ? "w-[40px]" : "w-[154.8px]"
            }`}
        >
            <Image
                {...imageProps}
                src={logoSrc}
                alt="Agenta Logo"
                width={154.8}
                height={51}
                style={{
                    transition: "transform 0.3s ease",
                    transform: isOnlyIconLogo ? "translateX(-5px)" : "translateX(0)",
                }}
            />
        </div>
    )
}

export default Logo
