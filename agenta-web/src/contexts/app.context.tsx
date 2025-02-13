import {ListAppsItem} from "@/lib/Types"
import {isDemo} from "@/lib/helpers/utils"
import {useRouter} from "next/router"
import {
    PropsWithChildren,
    createContext,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react"
import useSWR from "swr"
import {HookAPI} from "antd/es/modal/useModal"
import {useLocalStorage} from "usehooks-ts"
import {useProfileData} from "./profile.context"
import {useProjectData, DEFAULT_UUID} from "./project.context"
import {useOrgData} from "./org.context"

type AppContextType = {
    currentApp: ListAppsItem | null
    apps: ListAppsItem[]
    error: any
    isLoading: boolean
    mutate: () => void
    recentlyVisitedAppId: string | null
    modalInstance?: HookAPI
    setModalInstance: (context: any) => void
}

const initialValues: AppContextType = {
    currentApp: null,
    apps: [],
    error: null,
    isLoading: false,
    mutate: () => {},
    recentlyVisitedAppId: null,
    setModalInstance: (context) => {},
}

export const useApps = (options = {}) => {
    const {projectId} = useProjectData()
    const {user} = useProfileData()

    const isMockProjectId = projectId === DEFAULT_UUID

    const {selectedOrg, loading} = useOrgData()
    const shouldFetch = !!user && (!isDemo() || !!selectedOrg?.id)
    const {data, error, isLoading, mutate} = useSWR(
        shouldFetch ? `/api/apps?` + (!isMockProjectId ? `project_id=${projectId}&` : "") : null,
        {
            ...options,
            shouldRetryOnError: false,
            revalidateOnFocus: false,
        },
    )

    return {
        data: (data || []) as ListAppsItem[],
        error,
        isLoading: isLoading ?? loading,
        mutate,
    }
}

export const AppContext = createContext<AppContextType>(initialValues)

export const useAppsData = () => useContext(AppContext)

const appContextValues = {...initialValues}

export const getAppValues = () => appContextValues

const AppContextProvider: React.FC<PropsWithChildren> = ({children}) => {
    const {isLoading: isProjectLoading} = useProjectData()
    const router = useRouter()
    const appId = router.query?.app_id as string
    const [recentlyVisitedAppId, setRecentlyVisitedAppId] = useLocalStorage<string | null>(
        "recentlyVisitedApp",
        null,
    )
    const currentAppRef = useRef<ListAppsItem | null>(null)
    const {
        data: apps,
        error,
        isLoading,
        mutate,
    } = useApps({
        onSuccess: (data) => {
            if (!appId) {
                return recentlyVisitedAppId
                    ? data.find((item: ListAppsItem) => item.app_id === recentlyVisitedAppId) ||
                          null
                    : null
            }
            currentAppRef.current = data.find((item: ListAppsItem) => item.app_id === appId) || null
        },
    })

    useEffect(() => {
        if (appId) {
            setRecentlyVisitedAppId(appId)
        }
    }, [appId])

    const currentApp = useMemo(() => {
        if (!appId) {
            return recentlyVisitedAppId
                ? apps.find((item: ListAppsItem) => item.app_id === recentlyVisitedAppId) || null
                : null
        }
        if (appId && appId === currentAppRef.current?.app_id) {
            return currentAppRef.current
        }
        const newApp = apps.find((item: ListAppsItem) => item.app_id === appId) || null
        currentAppRef.current = newApp
        return currentAppRef.current
    }, [apps, appId, recentlyVisitedAppId])

    useEffect(() => {
        if (!currentApp) {
            setRecentlyVisitedAppId(null)
        }
    }, [currentApp])

    const [modalInstance, setModalInstance] = useState()

    return (
        <AppContext.Provider
            value={{
                currentApp,
                apps,
                error,
                isLoading: isLoading || isProjectLoading,
                mutate,
                modalInstance,
                setModalInstance,
                recentlyVisitedAppId,
            }}
        >
            {children}
        </AppContext.Provider>
    )
}

export default AppContextProvider
