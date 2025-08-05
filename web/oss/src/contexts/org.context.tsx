import {PropsWithChildren, createContext, useCallback, useContext, useEffect, useState} from "react"

import {useRouter} from "next/router"

import {useProfileData} from "@/oss/contexts/profile.context"
import {useSession} from "@/oss/hooks/useSession"
import useStateCallback from "@/oss/hooks/useStateCallback"
import {Org, OrgDetails} from "@/oss/lib/Types"
import {fetchAllOrgsList, fetchSingleOrg} from "@/oss/services/organization/api"

export const LS_ORG_KEY = "selectedOrg"

interface OrgContextType {
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
                logout()
            })
            .finally(() => setLoadingOrgs(false))
    }, [])

    useEffect(() => {
        if (user?.id && orgs.length > 0) {
            setLoadingOrgDetails(true)
            const org =
                orgs.find((org: Org) => org.id === localStorage.getItem(LS_ORG_KEY)) ||
                orgs.find((org: Org) => org.owner === user.id) ||
                orgs[0]
            if (org?.id) {
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

    useEffect(() => {
        localStorage.setItem(LS_ORG_KEY, selectedOrg?.id || "")
    }, [selectedOrg?.id])

    useEffect(() => {
        // fetch profile and orgs list only if user is logged in
        if (doesSessionExist) {
            fetchAllOrgs()
        }
    }, [doesSessionExist])

    const changeSelectedOrg: OrgContextType["changeSelectedOrg"] = (orgId, onSuccess) => {
        setLoadingOrgDetails(true)
        const org = orgs.find((org) => org.id === orgId) || selectedOrg
        if (!org?.id) return
        fetchSingleOrg({orgId: org?.id!})
            .then((data) => {
                setSelectedOrg(data)
                if (onSuccess) {
                    onSuccess()
                }
                if (!router.asPath.includes("/settings")) {
                    router.push("/apps")
                }
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
