import {ListAppsItem} from "@/lib/Types"
import {useRouter} from "next/router"
import {
    Dispatch,
    PropsWithChildren,
    SetStateAction,
    createContext,
    useContext,
    useMemo,
    useState,
} from "react"

type AppContextType = {
    currentApp: ListAppsItem | null
    apps: ListAppsItem[]
    setApps: Dispatch<SetStateAction<ListAppsItem[]>>
}

const initialValues: AppContextType = {
    currentApp: null,
    apps: [],
    setApps: () => {},
}

export const AppContext = createContext<AppContextType>(initialValues)

export const useAppContext = () => useContext(AppContext)

const AppContextProvider: React.FC<PropsWithChildren> = ({children}) => {
    const [apps, setApps] = useState(initialValues.apps)
    const router = useRouter()
    const appId = router.query?.app_id as string

    const currentApp = useMemo(
        () => (!appId ? null : apps.find((item) => item.app_id === appId) || null),
        [apps, appId],
    )

    return <AppContext.Provider value={{currentApp, apps, setApps}}>{children}</AppContext.Provider>
}

export default AppContextProvider
