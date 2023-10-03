import {useSessionContext} from "supertokens-auth-react/recipe/session"

const isDemo = process.env.REACT_APP_DEMO === "true"

export const useSession: () => {loading: boolean; doesSessionExist: boolean} = isDemo
    ? (useSessionContext as any)
    : () => ({
          loading: false,
          doesSessionExist: true,
      })
