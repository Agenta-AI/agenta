import {ListAppsItem} from "@/lib/Types"
import {useRouter} from "next/router"
import {PropsWithChildren, createContext, useContext, useMemo, useState} from "react"

const isDemo = process.env.NEXT_PUBLIC_FF === "demo"

// conditionally import the useApps hook based on the demo flag
let useApps: any = () => ({isLoading: true})
import(`@/lib/services/api${isDemo ? "_ee" : ""}`).then((module) => (useApps = module.useApps))

type AppContextType = {
    currentApp: ListAppsItem | null
    apps: ListAppsItem[]
    error: any
    isLoading: boolean
}

const initialValues: AppContextType = {
    currentApp: null,
    apps: [],
    error: null,
    isLoading: false,
}

export const AppContext = createContext<AppContextType>(initialValues)

export const useAppContext = () => useContext(AppContext)

const appContextValues = {...initialValues}

export const getAppValues = () => appContextValues

const AppContextProvider: React.FC<PropsWithChildren> = ({children}) => {
    const {data: apps, error, isLoading} = useApps()
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

    return (
        <AppContext.Provider value={{currentApp, apps, error, isLoading}}>
            {children}
        </AppContext.Provider>
    )
}

export default AppContextProvider
