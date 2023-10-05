import {useSession} from "@/hooks/useSession"
import useStateCallback from "@/hooks/useStateCallback"
import {getOrgsList, getProfile} from "@/lib/services/api"
import {Org, User} from "@/lib/Types"
import {useRouter} from "next/router"
import {
    PropsWithChildren,
    createContext,
    useState,
    useContext,
    useEffect,
    useCallback,
    useMemo,
} from "react"
import {useUpdateEffect} from "usehooks-ts"

const LS_ORG_KEY = "selectedOrg"

export enum Role {
    OWNER = "owner",
    ADMIN = "admin",
    MEMBER = "member",
}

type ProfileContextType = {
    user: User | null
    orgs: Org[]
    selectedOrg: Org | null
    role: Role | null
    loading: boolean
    changeSelectedOrg: (orgId: string, onSuccess?: () => void) => void
    reset: () => void
    refetch: (onSuccess?: () => void) => void
}

const initialValues: ProfileContextType = {
    user: null,
    orgs: [],
    selectedOrg: null,
    role: null,
    loading: false,
    changeSelectedOrg: () => {},
    reset: () => {},
    refetch: () => {},
}

export const ProfileContext = createContext<ProfileContextType>(initialValues)

export const useProfileData = () => useContext(ProfileContext)

const profileContextValues = {...initialValues}

export const getProfileValues = () => profileContextValues

const ProfileContextProvider: React.FC<PropsWithChildren> = ({children}) => {
    const router = useRouter()
    const [user, setUser] = useState<User | null>(null)
    const [orgs, setOrgs] = useState<Org[]>([])
    const [selectedOrg, setSelectedOrg] = useStateCallback<Org | null>(null)
    const [loading, setLoading] = useState(false)
    const context = useSession()

    const fetcher = useCallback((onSuccess?: () => void) => {
        setLoading(true)
        Promise.all([getProfile(), getOrgsList()])
            .then(([profile, orgs]) => {
                setUser(profile.data)
                setOrgs(orgs.data)
                setSelectedOrg(
                    orgs.data.find((org: Org) => org.id === localStorage.getItem(LS_ORG_KEY)) ||
                        orgs.data.find((org: Org) => org.owner === profile.data.id) ||
                        orgs.data[0] ||
                        null,
                    onSuccess,
                )
            })
            .catch(console.error)
            .finally(() => setLoading(false))
    }, [])

    useUpdateEffect(() => {
        localStorage.setItem(LS_ORG_KEY, selectedOrg?.id || "")
    }, [selectedOrg?.id])

    useEffect(() => {
        // fetch profile and orgs list only if user is logged in
        if (context.doesSessionExist) {
            fetcher()
        }
    }, [context.doesSessionExist])

    const changeSelectedOrg: ProfileContextType["changeSelectedOrg"] = (orgId, onSuccess) => {
        setSelectedOrg(
            orgs.find((org) => org.id === orgId) || selectedOrg,
            onSuccess ||
                (() => {
                    router.push("/apps")
                }),
        )
    }

    const reset = () => {
        setUser(initialValues.user)
        setOrgs(initialValues.orgs)
        setSelectedOrg(initialValues.selectedOrg)
    }

    const role = useMemo(
        () => (loading ? null : selectedOrg?.owner === user?.id ? Role.OWNER : Role.MEMBER),
        [selectedOrg, user, loading],
    )

    profileContextValues.user = user
    profileContextValues.orgs = orgs
    profileContextValues.selectedOrg = selectedOrg
    profileContextValues.changeSelectedOrg = changeSelectedOrg

    return (
        <ProfileContext.Provider
            value={{
                user,
                orgs,
                selectedOrg,
                role,
                loading,
                changeSelectedOrg,
                reset,
                refetch: fetcher,
            }}
        >
            {children}
        </ProfileContext.Provider>
    )
}

export default ProfileContextProvider
