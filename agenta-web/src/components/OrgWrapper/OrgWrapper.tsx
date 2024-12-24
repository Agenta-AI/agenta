import {useState, useEffect, useCallback, ComponentType, FC} from "react"
import {isDemo} from "@/lib/helpers/utils"
import {dynamicContext} from "@/lib/helpers/dynamic"

type OrgWrapperProps = {children: React.ReactNode}

const OrgWrapper: FC<OrgWrapperProps> = ({children}) => {
    const [OrgContextProvider, setOrgContextProvider] =
        useState<ComponentType<OrgWrapperProps> | null>(null)

    const initializeOrgProvider = useCallback(async () => {
        const Provider = await dynamicContext("org.context")
        setOrgContextProvider(() => Provider.default)
    }, [])

    useEffect(() => {
        if (isDemo()) {
            initializeOrgProvider()
        }
    }, [initializeOrgProvider])

    if (isDemo() && OrgContextProvider) {
        return <OrgContextProvider>{children}</OrgContextProvider>
    }

    return <>{children}</>
}

export default OrgWrapper
