import {useAtomValue} from "jotai"

import {routerAppIdAtom} from "../state/app"

export const useAppId = (): string => {
    const appId = useAtomValue(routerAppIdAtom)
    return appId || ""
}
