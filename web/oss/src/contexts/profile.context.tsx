import {PropsWithChildren, createContext, useState, useContext, useEffect, useCallback} from "react"

import {useSession} from "@/oss/hooks/useSession"
import useStateCallback from "@/oss/hooks/useStateCallback"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {User} from "@/oss/lib/Types"
import {fetchProfile} from "@/oss/services/api"

interface ProfileContextType {
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
        fetchProfile()
            .then((profile) => {
                posthog?.identify?.()
                setUser(profile.data, onSuccess)
            })
            .catch((error) => {
                console.error(error)
                logout()
            })
            .finally(() => setLoading(false))
    }, [])

    useEffect(() => {
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
