import {useCallback, useEffect} from "react"

import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {
    AUTH_UPGRADE_IDENTITIES_KEY,
    AUTH_UPGRADE_ORG_KEY,
    authUpgradeAtom,
    resetAuthUpgradeState,
} from "@/oss/state/org/authUpgrade"
import {orgsAtom, selectedOrgIdAtom} from "@/oss/state/org/selectors/org"
import {authFlowAtom} from "@/oss/state/session"

import AuthUpgradeModal from "../Sidebar/components/AuthUpgradeModal"

/**
 * App-level host for the org auth-upgrade prompt. The org switcher (or any future entry point)
 * only sets `authUpgradeAtom`; this component owns rendering and teardown so the flow no longer
 * lives inside the sidebar selector.
 */
const AuthUpgradeHost = () => {
    const [{open, orgId, detail}, setAuthUpgrade] = useAtom(authUpgradeAtom)
    const selectedOrgId = useAtomValue(selectedOrgIdAtom)
    const orgs = useAtomValue(orgsAtom)
    const setAuthFlow = useSetAtom(authFlowAtom)

    const organizationName = Array.isArray(orgs)
        ? orgs.find((org) => org.id === orgId)?.name
        : undefined

    const close = useCallback(() => {
        setAuthUpgrade(resetAuthUpgradeState())
        setAuthFlow("authed")
        if (typeof window !== "undefined") {
            window.localStorage.removeItem(AUTH_UPGRADE_ORG_KEY)
            window.localStorage.removeItem(AUTH_UPGRADE_IDENTITIES_KEY)
        }
    }, [setAuthFlow, setAuthUpgrade])

    // The upgrade succeeded once the selected org becomes the org we prompted for.
    useEffect(() => {
        if (open && orgId && selectedOrgId && orgId === selectedOrgId) {
            close()
        }
    }, [close, open, orgId, selectedOrgId])

    if (!open) return null

    return (
        <AuthUpgradeModal
            open={open}
            organizationName={organizationName}
            detail={detail}
            onCancel={close}
        />
    )
}

export default AuthUpgradeHost
