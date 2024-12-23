import {useState, useEffect, useCallback} from "react"
import {isDemo} from "@/lib/helpers/utils"
import {dynamicContext} from "@/lib/helpers/dynamic"

const OrgWrapper = ({children}: {children: React.ReactNode}) => {
    const [Wrapper, setWrapper] = useState<any>(null)

    const initilizeOrgProvider = useCallback(async () => {
        const OrgContextProvider = await dynamicContext("org.context", Wrapper)
        setWrapper(() => OrgContextProvider.default)
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
