import {memo, type FC, type PropsWithChildren} from "react"

import {useAtomValue} from "jotai"

import {useSession} from "@/oss/hooks/useSession"
import {selectedOrgAtom, selectedOrgQueryAtom} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {useProjectData} from "@/oss/state/project"
import {protectedRouteReadyAtom} from "@/oss/state/url/test"

// Null-rendering island for the boot-volatile session/project/profile/org hook mounts:
// their effects and query subscriptions must stay alive here, but their re-renders
// must not drag the page subtree along.
const BootSubscriptions = memo(function BootSubscriptions() {
    useSession()
    useProjectData()
    useProfileData()
    useAtomValue(selectedOrgAtom)
    useAtomValue(selectedOrgQueryAtom)
    return null
})

const ProtectedRoute: FC<PropsWithChildren> = ({children}) => {
    const ready = useAtomValue(protectedRouteReadyAtom)

    return (
        <>
            <BootSubscriptions />
            {ready ? children : null}
        </>
    )
}

export default ProtectedRoute
