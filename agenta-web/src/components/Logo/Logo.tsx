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
    return <Image src={logoSrc} alt="Agenta Logo" width={129} height={42.5} />
}

export default Logo
