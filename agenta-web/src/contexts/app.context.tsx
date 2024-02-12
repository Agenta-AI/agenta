import {ListAppsItem} from "@/lib/Types"
import {getAgentaApiUrl, isDemo} from "@/lib/helpers/utils"
import {axiosFetcher} from "@/lib/services/api"
import {useRouter} from "next/router"
import {PropsWithChildren, createContext, useContext, useEffect, useMemo, useState} from "react"
import useSWR from "swr"
import {dynamicContext} from "@/lib/helpers/dynamic"

type AppContextType = {
    currentApp: ListAppsItem | null
    apps: ListAppsItem[]
    error: any
    isLoading: boolean
    mutate: () => void
}

const initialValues: AppContextType = {
    currentApp: null,
    apps: [],
    error: null,
    isLoading: false,
    mutate: () => {},
}

const useApps = () => {
    const [useOrgData, setUseOrgData] = useState<Function>(() => () => "")

    useEffect(() => {
        dynamicContext("org.context", {useOrgData}).then((context) => {
            setUseOrgData(() => context.useOrgData)
        })
    }, [])

    const {selectedOrg, loading} = useOrgData()
    const {data, error, isLoading, mutate} = useSWR(
        `${getAgentaApiUrl()}/api/apps/` +
            (isDemo()
                ? `?org_id=${selectedOrg?.id}&workspace_id=${selectedOrg?.default_workspace.id}`
                : ""),
        isDemo() ? (selectedOrg?.id ? axiosFetcher : () => {}) : axiosFetcher,
    )
    return {
        data: (data || []) as ListAppsItem[],
        error,
        isLoading: isLoading || loading,
        mutate,
    }
}

export const AppContext = createContext<AppContextType>(initialValues)

export const useAppsData = () => useContext(AppContext)

const appContextValues = {...initialValues}

export const getAppValues = () => appContextValues

const AppContextProvider: React.FC<PropsWithChildren> = ({children}) => {
    const {data: apps, error, isLoading, mutate} = useApps()
    const router = useRouter()
    const appId = router.query?.app_id as string

    const currentApp = useMemo(
        () => (!appId ? null : apps.find((item: ListAppsItem) => item.app_id === appId) || null),
        [apps, appId],
    )

    appContextValues.currentApp = currentApp
    appContextValues.apps = apps
    appContextValues.error = error
    appContextValues.isLoading = isLoading
    appContextValues.mutate = mutate

    return (
        <AppContext.Provider value={{currentApp, apps, error, isLoading, mutate}}>
            {children}
        </AppContext.Provider>
    )
}

export default AppContextProvider
