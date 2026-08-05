export * from "./selectors/user"
export * from "./hooks"
import {getDefaultStore} from "jotai"
import {loadable} from "jotai/vanilla/utils"
import {queryClientAtom} from "jotai-tanstack-query"

import {profileQueryAtom} from "./selectors/user"

export const getProfileValues = () => {
    const state = getDefaultStore().get(loadable(profileQueryAtom))
    if (state.state === "hasData") {
        return {user: state.data ?? null, loading: false}
    }
    return {user: null, loading: true}
}

export const resetProfileData = () => {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)
    queryClient.removeQueries({queryKey: ["profile"]})
}
