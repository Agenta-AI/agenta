import {useState, useEffect, useCallback} from "react"
import {isDemo} from "@/lib/helpers/utils"

const OrgWrapper = ({children}: {children: React.ReactNode}) => {
    const [Wrapper, setWrapper] = useState<any>(null)

    const initilizeOrgProvider = useCallback(async () => {
        const OrgProvider = (await import("@/contexts/org.context")).default
        setWrapper(() => OrgProvider)
    }, [])

    useEffect(() => {
        if (isDemo()) {
            initilizeOrgProvider()
        }
    }, [initilizeOrgProvider])

    if (isDemo()) {
        return Wrapper ? <Wrapper>{children}</Wrapper> : null
    }

    return <>{children}</>
}

export default OrgWrapper
