import {atom, getDefaultStore} from "jotai"
import Router from "next/router"
import {signOut} from "supertokens-auth-react/recipe/session"

import {queryClient} from "@/oss/lib/api/queryClient"
import {fetchAllOrgsList} from "@/oss/services/organization/api"
import {
    appIdentifiersAtom,
    appStateSnapshotAtom,
    navigationRequestAtom,
    requestNavigationAtom,
} from "@/oss/state/appState"
import {orgsAtom, resolvePreferredWorkspaceId} from "@/oss/state/org"
import {profileQueryAtom, userAtom} from "@/oss/state/profile/selectors/user"
import {sessionExistsAtom, sessionLoadingAtom} from "@/oss/state/session"
import {urlAtom} from "@/oss/state/url"

const isBrowser = typeof window !== "undefined"

export interface InvitePayload {
    token: string
    email?: string
    organization_id?: string
    workspace_id?: string
    project_id?: string
    survey?: string
}

const INVITE_STORAGE_KEY = "invite"
const POST_SIGNUP_PENDING_KEY = "postSignupPending"
const POST_SIGNUP_TTL_MS = 2 * 60 * 1000
let authOrgFetchInFlight = false

export const protectedRouteReadyAtom = atom(false)
export const activeInviteAtom = atom<InvitePayload | null>(null)

export const parseInviteFromUrl = (url: URL): InvitePayload | null => {
    const token = url.searchParams.get("token")?.trim()
    if (!token) return null

    const invite: InvitePayload = {token}
    const fields: (keyof InvitePayload)[] = [
        "email",
        "organization_id",
        "workspace_id",
        "project_id",
        "survey",
    ]

    fields.forEach((field) => {
        const value = url.searchParams.get(field)?.trim()
        if (value) {
            invite[field] = field === "email" ? value.toLowerCase() : value
        }
    })

    return invite
}

export const readInviteFromStorage = (): InvitePayload | null => {
    if (!isBrowser) return null
    try {
        const raw = window.localStorage.getItem(INVITE_STORAGE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed.token === "string" && parsed.token.trim()) {
            return {
                token: parsed.token.trim(),
                email: typeof parsed.email === "string" ? parsed.email.toLowerCase() : undefined,
                organization_id:
                    typeof parsed.organization_id === "string" ? parsed.organization_id : undefined,
                workspace_id:
                    typeof parsed.workspace_id === "string" ? parsed.workspace_id : undefined,
                project_id: typeof parsed.project_id === "string" ? parsed.project_id : undefined,
                survey: typeof parsed.survey === "string" ? parsed.survey : undefined,
            }
        }
    } catch (error) {
        console.error("Failed to read invite from storage:", error)
    }
    return null
}

export const persistInviteToStorage = (invite: InvitePayload | null) => {
    if (!isBrowser) return
    try {
        if (invite && invite.token) {
            window.localStorage.setItem(INVITE_STORAGE_KEY, JSON.stringify(invite))
        } else {
            window.localStorage.removeItem(INVITE_STORAGE_KEY)
        }
    } catch (error) {
        console.error("Failed to persist invite to storage:", error)
    }
}

export const isCurrentAcceptRouteForInvite = (appState: any, invite: InvitePayload) => {
    if (!appState.pathname?.startsWith("/workspaces/accept")) return false
    const tokenParam = appState.query?.token
    const currentToken = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam
    return currentToken === invite.token
}

export const writePostSignupPending = () => {
    if (!isBrowser) return
    try {
        window.sessionStorage.setItem(
            POST_SIGNUP_PENDING_KEY,
            JSON.stringify({ts: Date.now()}),
        )
    } catch {
        // ignore storage failures
    }
}

const readPostSignupPending = (): boolean => {
    if (!isBrowser) return false
    try {
        const raw = window.sessionStorage.getItem(POST_SIGNUP_PENDING_KEY)
        if (!raw) return false
        const parsed = JSON.parse(raw) as {ts?: number}
        if (!parsed?.ts) return false
        if (Date.now() - parsed.ts > POST_SIGNUP_TTL_MS) return false
        return true
    } catch {
        return false
    }
}

const clearPostSignupPending = () => {
    if (!isBrowser) return
    try {
        window.sessionStorage.removeItem(POST_SIGNUP_PENDING_KEY)
    } catch {
        // ignore storage failures
    }
}

export const syncAuthStateFromUrl = (nextUrl?: string) => {
    if (!isBrowser) return

    try {
        const store = getDefaultStore()
        const url = new URL(nextUrl ?? window.location.href, window.location.origin)
        const appState = store.get(appStateSnapshotAtom)
        const sessionLoading = store.get(sessionLoadingAtom)
        const isSignedIn = store.get(sessionExistsAtom)
        const user = store.get(userAtom)
        const urlState = store.get(urlAtom)

        const resolvedPath = nextUrl ? url.pathname : (appState.pathname ?? url.pathname)
        const resolvedAsPath = nextUrl
            ? `${url.pathname}${url.search}${url.hash}`
            : (appState.asPath ?? `${url.pathname}${url.search}${url.hash}`)
        const path = resolvedPath
        const asPath = resolvedAsPath
        const isAuthRoute = path.startsWith("/auth")
        const isAuthCallbackRoute = path.startsWith("/auth/callback")
        const isAcceptRoute = path.startsWith("/workspaces/accept")
        const isPostSignupRoute = path.startsWith("/post-signup")
        const authError =
            typeof appState.query?.auth_error === "string" ? appState.query.auth_error : null
        const baseAppURL = urlState.baseAppURL || "/w"

        let invite = parseInviteFromUrl(url)
        if (invite) {
            persistInviteToStorage(invite)
        } else {
            const storedInvite = readInviteFromStorage()
            if (storedInvite) {
                invite = storedInvite
            }
        }
        store.set(activeInviteAtom, invite ?? null)

        if (sessionLoading) {
            store.set(protectedRouteReadyAtom, false)
            return
        }

        if (isSignedIn) {
            if (isPostSignupRoute) {
                console.log("[auth-sync] signed in on /post-signup", {
                    path,
                    asPath,
                    baseAppURL,
                })
                clearPostSignupPending()
            }
            if (isAuthCallbackRoute) {
                store.set(protectedRouteReadyAtom, false)
                return
            }
            if (isAuthRoute) {
                if (readPostSignupPending()) {
                    clearPostSignupPending()
                    void Router.replace("/post-signup").catch((error) => {
                        console.error("Failed to redirect to post-signup:", error)
                    })
                    store.set(protectedRouteReadyAtom, false)
                    return
                }
            }
            if (typeof window !== "undefined") {
                const upgradeOrgId = window.localStorage.getItem("authUpgradeOrgId")
                const identifiers = store.get(appIdentifiersAtom)
                const currentWorkspaceId = identifiers.workspaceId
                const upgradePath = upgradeOrgId ? `/w/${encodeURIComponent(upgradeOrgId)}` : null
                const alreadyOnUpgradePath =
                    Boolean(upgradePath) && path.startsWith(upgradePath as string)

                if (upgradeOrgId && alreadyOnUpgradePath) {
                    window.localStorage.removeItem("authUpgradeOrgId")
                    window.localStorage.removeItem("authUpgradeSessionIdentities")
                } else if (upgradeOrgId && upgradeOrgId !== currentWorkspaceId) {
                    void Router.replace(`/w/${encodeURIComponent(upgradeOrgId)}`).catch((error) => {
                        console.error(
                            "Failed to redirect authenticated user to upgrade org:",
                            error,
                        )
                    })
                    store.set(protectedRouteReadyAtom, false)
                    return
                }
            }

            if (invite && !isAcceptRoute) {
                const inviteEmail = invite.email?.toLowerCase() ?? undefined
                const userEmail = user?.email?.toLowerCase()
                const profileQuery = store.get(profileQueryAtom)
                const profileLoading = profileQuery.isPending || profileQuery.isFetching

                // If invite has an email but user profile is still loading, wait
                // This prevents race conditions where we redirect to accept before
                // we can check if the emails match
                if (inviteEmail && !userEmail && profileLoading) {
                    store.set(protectedRouteReadyAtom, false)
                    return
                }

                if (!inviteEmail || !userEmail || inviteEmail === userEmail) {
                    if (!isCurrentAcceptRouteForInvite(appState, invite)) {
                        void Router.replace({pathname: "/workspaces/accept", query: invite}).catch(
                            (error) => {
                                console.error("Failed to redirect to invite acceptance:", error)
                            },
                        )
                    }
                    store.set(protectedRouteReadyAtom, false)
                    return
                }
                // Invite exists but emails don't match - if on auth route, show the page
                // so user can sign out and sign in with the correct account
                if (isAuthRoute && inviteEmail && userEmail && inviteEmail !== userEmail) {
                    store.set(protectedRouteReadyAtom, true)
                    return
                }
            }

            if (isPostSignupRoute) {
                store.set(protectedRouteReadyAtom, true)
                return
            }

            if (isAuthRoute) {
                if (authError === "sso_denied") {
                    if (typeof window !== "undefined") {
                        signOut().catch(() => null)
                    }
                    store.set(protectedRouteReadyAtom, true)
                    return
                }
                // When auth upgrade is required, stay on auth page to show the upgrade message
                // The user needs to re-authenticate with the correct method
                if (authError === "upgrade_required") {
                    store.set(protectedRouteReadyAtom, true)
                    return
                }
                if (typeof window !== "undefined") {
                    const upgradeOrgId = window.localStorage.getItem("authUpgradeOrgId")
                    if (upgradeOrgId) {
                        void Router.replace(`/w/${encodeURIComponent(upgradeOrgId)}`).catch(
                            (error) => {
                                console.error(
                                    "Failed to redirect authenticated user to upgrade org:",
                                    error,
                                )
                            },
                        )
                        store.set(protectedRouteReadyAtom, false)
                        return
                    }
                }
                const orgs = store.get(orgsAtom)
                if (process.env.NEXT_PUBLIC_LOG_ORG_ATOMS === "true") {
                    console.log("[auth-redirect] orgs snapshot", {
                        count: Array.isArray(orgs) ? orgs.length : 0,
                        orgs: Array.isArray(orgs)
                            ? orgs.map((org) => ({
                                  id: org.id,
                              }))
                            : [],
                    })
                }
                const targetWorkspaceId = resolvePreferredWorkspaceId(user?.id ?? null, orgs)
                const targetHref = targetWorkspaceId
                    ? `/w/${encodeURIComponent(targetWorkspaceId)}`
                    : "/w"
                if (process.env.NEXT_PUBLIC_LOG_ORG_ATOMS === "true") {
                    console.log("[auth-redirect] resolved", {
                        targetWorkspaceId,
                        targetHref,
                        path,
                        baseAppURL,
                    })
                }
                if (!targetWorkspaceId && !authOrgFetchInFlight) {
                    authOrgFetchInFlight = true
                    void queryClient
                        .fetchQuery({
                            queryKey: ["orgs", user?.id || ""],
                            queryFn: () => fetchAllOrgsList(),
                            staleTime: 60_000,
                        })
                        .then((freshOrgs) => {
                            const resolved = resolvePreferredWorkspaceId(
                                user?.id ?? null,
                                freshOrgs,
                            )
                            if (process.env.NEXT_PUBLIC_LOG_ORG_ATOMS === "true") {
                                console.log("[auth-redirect] fetched orgs", {
                                    count: Array.isArray(freshOrgs) ? freshOrgs.length : 0,
                                    resolved,
                                })
                            }
                            if (resolved) {
                                store.set(requestNavigationAtom, {
                                    type: "href",
                                    href: `/w/${encodeURIComponent(resolved)}`,
                                    method: "replace",
                                })
                            }
                        })
                        .catch(() => null)
                        .finally(() => {
                            authOrgFetchInFlight = false
                        })
                }
                if (!path.startsWith(targetHref)) {
                    console.log("[auth-sync] redirecting to app", {from: path, to: targetHref})
                    void Router.replace(targetHref).catch((error) => {
                        console.error("Failed to redirect authenticated user to app:", error)
                    })
                }
                store.set(protectedRouteReadyAtom, false)
                return
            }

            if (isAcceptRoute) {
                if (!invite) {
                    if (!path.startsWith(baseAppURL)) {
                        void Router.replace(baseAppURL).catch((error) => {
                            console.error("Failed to redirect from empty invite route:", error)
                        })
                    }
                    store.set(protectedRouteReadyAtom, false)
                } else {
                    const inviteEmail = invite.email ?? undefined
                    const userEmail = user?.email?.toLowerCase()
                    if (inviteEmail && userEmail && inviteEmail !== userEmail) {
                        if (!path.startsWith(baseAppURL)) {
                            void Router.replace(baseAppURL).catch((error) => {
                                console.error(
                                    "Failed to redirect due to invite email mismatch:",
                                    error,
                                )
                            })
                        }
                        store.set(protectedRouteReadyAtom, false)
                        return
                    }
                }
            }

            if (path === "/w") {
                const identifiers = store.get(appIdentifiersAtom)
                if (!identifiers.workspaceId) {
                    const orgs = store.get(orgsAtom)
                    const targetWorkspaceId = resolvePreferredWorkspaceId(user?.id ?? null, orgs)

                    if (targetWorkspaceId) {
                        const pendingCommand = store.get(navigationRequestAtom)
                        if (!pendingCommand) {
                            store.set(requestNavigationAtom, {
                                type: "href",
                                href: `/w/${encodeURIComponent(targetWorkspaceId)}`,
                                method: "replace",
                            })
                        }
                        store.set(protectedRouteReadyAtom, false)
                        return
                    }
                }
            }

            store.set(protectedRouteReadyAtom, true)
            return
        }

        if (isAuthRoute) {
            store.set(protectedRouteReadyAtom, true)
            return
        }

        const redirectToPath = `/auth?redirectToPath=${encodeURIComponent(asPath)}`
        if (asPath !== redirectToPath) {
            void Router.replace(redirectToPath).catch((error) => {
                console.error("Failed to redirect unauthenticated user to auth:", error)
            })
        }
        store.set(protectedRouteReadyAtom, false)
    } catch (err) {
        console.error("Failed to sync auth state from URL:", nextUrl, err)
    }
}
