import Image from "next/image"
import {useMemo} from "react"
import {useAppTheme} from "../Layout/ThemeContextProvider"

const Logo: React.FC<Partial<React.ComponentProps<typeof Image>>> = (props) => {
    const {appTheme} = useAppTheme()

    const logoSrc = useMemo(
        () =>
            appTheme === "dark"
                ? "/assets/dark-complete-transparent-CROPPED.png"
                : "/assets/light-complete-transparent-CROPPED.png",
        [appTheme],
    )
    return <Image width={154.8} height={51} {...props} src={logoSrc} alt="Agenta Logo" />
}

export default Logo
