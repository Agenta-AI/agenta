import {useSession} from "@/hooks/useSession"
import useStateCallback from "@/hooks/useStateCallback"
import {isDemo} from "@/lib/helpers/utils"
import {fetchSingleOrg, fetchAllOrgsList} from "@/services/organization/api"
import {Org, OrgDetails} from "@/lib/Types"
import {useRouter} from "next/router"
import React, {
    PropsWithChildren,
    createContext,
    useState,
    useContext,
    useEffect,
    useCallback,
} from "react"
import {useUpdateEffect} from "usehooks-ts"
import {useProfileData} from "@/contexts/profile.context"

const LS_ORG_KEY = "selectedOrg"

type OrgContextType = {
    orgs: Org[]
    selectedOrg: OrgDetails | null
    loading: boolean
    changeSelectedOrg: (orgId: string, onSuccess?: () => void) => void
    setSelectedOrg: React.Dispatch<React.SetStateAction<OrgDetails | null>>
    reset: () => void
    refetch: (onSuccess?: () => void) => void
}

const initialValues: OrgContextType = {
    orgs: [],
    selectedOrg: null,
    loading: false,
    changeSelectedOrg: () => {},
    setSelectedOrg: () => {},
    reset: () => {},
    refetch: () => {},
}

export const OrgContext = createContext<OrgContextType>(initialValues)

export const useOrgData = () => useContext(OrgContext)

const orgContextValues = {...initialValues}

export const getOrgValues = () => orgContextValues

const OrgContextProvider: React.FC<PropsWithChildren> = ({children}) => {
    const [orgs, setOrgs] = useStateCallback<Org[]>([])
    const [selectedOrg, setSelectedOrg] = useStateCallback<OrgDetails | null>(null)
    const [loadingOrgs, setLoadingOrgs] = useState(false)
    const [loadingOrgDetails, setLoadingOrgDetails] = useState(false)
    const {logout, doesSessionExist} = useSession()
    const {user} = useProfileData()
    const router = useRouter()

    const fetchAllOrgs = useCallback((onSuccess?: () => void) => {
        setLoadingOrgs(true)
        fetchAllOrgsList()
            .then((orgs) => {
                setOrgs(orgs, onSuccess)
            })
            .catch((error) => {
                console.error(error)
                if (isDemo()) logout()
            })
            .finally(() => setLoadingOrgs(false))
    }, [])

    useUpdateEffect(() => {
        if (user?.id && orgs.length > 0) {
            setLoadingOrgDetails(true)
            const org =
                orgs.find((org: Org) => org.id === localStorage.getItem(LS_ORG_KEY)) ||
                orgs.find((org: Org) => org.owner === user.id) ||
                orgs[0]
            if (org) {
                fetchSingleOrg({orgId: org.id})
                    .then(setSelectedOrg)
                    .catch(console.error)
                    .finally(() => setLoadingOrgDetails(false))
            } else {
                setSelectedOrg(null)
                setLoadingOrgDetails(false)
            }
        }
    }, [user?.id, orgs])

    useUpdateEffect(() => {
        localStorage.setItem(LS_ORG_KEY, selectedOrg?.id || "")
    }, [selectedOrg?.id])

    useEffect(() => {
        // fetch profile and orgs list only if user is logged in
        if (doesSessionExist && isDemo()) {
            fetchAllOrgs()
        }
    }, [doesSessionExist])

    if (!isDemo()) {
        return <OrgContext.Provider value={initialValues}>{children}</OrgContext.Provider>
    }

    const changeSelectedOrg: OrgContextType["changeSelectedOrg"] = (orgId, onSuccess) => {
        setLoadingOrgDetails(true)
        const org = orgs.find((org) => org.id === orgId) || selectedOrg
        fetchSingleOrg({orgId: org?.id!})
            .then((data) => {
                setSelectedOrg(data)
                if (onSuccess) {
                    onSuccess()
                }
                router.push("/apps")
            })
            .finally(() => setLoadingOrgDetails(false))
            .catch(console.error)
    }

    const reset = () => {
        setOrgs(initialValues.orgs)
        setSelectedOrg(initialValues.selectedOrg)
    }

    orgContextValues.orgs = orgs
    orgContextValues.selectedOrg = selectedOrg
    orgContextValues.changeSelectedOrg = changeSelectedOrg
    orgContextValues.setSelectedOrg = setSelectedOrg

    return (
        <OrgContext.Provider
            value={{
                orgs,
                selectedOrg,
                loading: loadingOrgs || loadingOrgDetails,
                changeSelectedOrg,
                setSelectedOrg,
                reset,
                refetch: fetchAllOrgs,
            }}
        >
            {children}
        </OrgContext.Provider>
    )
}

export default OrgContextProvider
