import {useProfileData} from "@/contexts/profile.context"
import {isDemo} from "@/lib/helpers/utils"
import {useRouter} from "next/router"
import posthog from "posthog-js"
import {useSessionContext} from "supertokens-auth-react/recipe/session"
import {signOut} from "supertokens-auth-react/recipe/thirdpartypasswordless"

export const useSession: () => {loading: boolean; doesSessionExist: boolean; logout: () => void} =
    isDemo()
        ? () => {
              const res = useSessionContext()
              const router = useRouter()
              const {reset} = useProfileData()

              return {
                  loading: res.loading,
                  doesSessionExist: (res as any).doesSessionExist,
                  logout: () => {
                      signOut()
                          .then(() => {
                              posthog.reset()
                              reset()
                              router.push("/auth")
                          })
                          .catch(console.error)
                  },
              }
          }
        : () => ({
              loading: false,
              doesSessionExist: true,
              logout: () => {},
          })
