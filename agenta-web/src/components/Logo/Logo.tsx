import Image from "next/image"
import {useMemo} from "react"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import useLogo from "@/lib/hooks/useLogo"
const Logo: React.FC = () => {
    const logoSrc = useLogo()

    return <Image src={logoSrc} alt="Agenta Logo" width={129} height={42.5} />
}

export default Logo
