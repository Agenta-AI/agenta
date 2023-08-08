import Image from "next/image"
import {useMemo} from "react"
import {useAppTheme} from "../Layout/ThemeContextProvider"
const Logo: React.FC = () => {
    const {appTheme} = useAppTheme()

    const logoSrc = useMemo(
        () =>
            appTheme === "dark"
                ? "/assets/dark-complete-transparent-CROPPED.png"
                : "/assets/light-complete-transparent-CROPPED.png",
        [appTheme],
    )
    return <Image priority src={logoSrc} alt="Agenta Logo" width={135} height={45} />
}

export default Logo
