import {isDemo} from "@/lib/helpers/utils"
import {useSessionContext} from "supertokens-auth-react/recipe/session"

export const useSession: () => {loading: boolean; doesSessionExist: boolean} = isDemo()
    ? (useSessionContext as any)
    : () => ({
          loading: false,
          doesSessionExist: true,
      })
