import {atom} from "jotai"

import type {AuthUpgradeDetail} from "@/oss/components/Sidebar/components/AuthUpgradeModal"

/** localStorage keys shared by the switcher (writes) and the auth-redirect flow (reads). */
export const AUTH_UPGRADE_ORG_KEY = "authUpgradeOrgId"
export const AUTH_UPGRADE_IDENTITIES_KEY = "authUpgradeSessionIdentities"

export interface AuthUpgradeState {
    open: boolean
    orgId: string | null
    detail: AuthUpgradeDetail | null
}

const INITIAL_AUTH_UPGRADE_STATE: AuthUpgradeState = {open: false, orgId: null, detail: null}

/**
 * App-level auth-upgrade prompt state. Any entry point that switches organizations sets this
 * atom on an `AUTH_UPGRADE_REQUIRED` / `AUTH_SSO_DENIED` response; a single app-level host
 * (`AuthUpgradeHost`) renders the modal. Keeps the flow out of the sidebar selector.
 */
export const authUpgradeAtom = atom<AuthUpgradeState>(INITIAL_AUTH_UPGRADE_STATE)

export const resetAuthUpgradeState = (): AuthUpgradeState => ({...INITIAL_AUTH_UPGRADE_STATE})
