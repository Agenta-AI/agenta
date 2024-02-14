import {usePostHogAg} from "@/hooks/usePostHogAg"
import {useSession} from "@/hooks/useSession"
import useStateCallback from "@/hooks/useStateCallback"
import {isDemo} from "@/lib/helpers/utils"
import {getProfile} from "@/lib/services/api"
import {User} from "@/lib/Types"
import {PropsWithChildren, createContext, useState, useContext, useEffect, useCallback} from "react"

type ProfileContextType = {
    user: User | null
    loading: boolean
    reset: () => void
    refetch: (onSuccess?: () => void) => void
}

const initialValues: ProfileContextType = {
    user: null,
    loading: false,
    reset: () => {},
    refetch: () => {},
}

export const ProfileContext = createContext<ProfileContextType>(initialValues)

export const useProfileData = () => useContext(ProfileContext)

const profileContextValues = {...initialValues}

export const getProfileValues = () => profileContextValues

const ProfileContextProvider: React.FC<PropsWithChildren> = ({children}) => {
    const posthog = usePostHogAg()
    const [user, setUser] = useStateCallback<User | null>(null)
    const [loading, setLoading] = useState(false)
    const {logout, doesSessionExist} = useSession()

    const fetcher = useCallback((onSuccess?: () => void) => {
        setLoading(true)
        getProfile()
            .then((profile) => {
                posthog.identify()
                setUser(profile.data, onSuccess)
            })
            .catch((error) => {
                console.error(error)
                if (isDemo()) logout()
            })
            .finally(() => setLoading(false))
    }, [])

    useEffect(() => {
        // fetch profile only if user is logged in
        if (doesSessionExist) {
            fetcher()
        }
    }, [doesSessionExist])

    const reset = () => {
        setUser(initialValues.user)
    }

    profileContextValues.user = user

    return (
        <ProfileContext.Provider
            value={{
                user,
                loading,
                reset,
                refetch: fetcher,
            }}
        >
            {children}
        </ProfileContext.Provider>
    )
}

export default ProfileContextProvider
