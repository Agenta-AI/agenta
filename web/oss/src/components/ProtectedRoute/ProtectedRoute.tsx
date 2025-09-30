import {type FC, type PropsWithChildren} from "react"

import {useAtomValue} from "jotai"

import {useSession} from "@/oss/hooks/useSession"
import {selectedOrgAtom, selectedOrgQueryAtom} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {useProjectData} from "@/oss/state/project"
import {protectedRouteReadyAtom} from "@/oss/state/url/test"

const ProtectedRoute: FC<PropsWithChildren> = ({children}) => {
    useSession()
    useProjectData()
    useProfileData()
    useAtomValue(selectedOrgAtom)
    useAtomValue(selectedOrgQueryAtom)
    const ready = useAtomValue(protectedRouteReadyAtom)

    return ready ? children : null
}

export default ProtectedRoute
