/**
 * The OAuth authorization dialog for one custom MCP endpoint: discover the scopes the
 * authorization server offers, let the author narrow them, then open the consent popup and wait
 * for the callback's typed `mcp:oauth:connected` message.
 *
 * It lives here, not in the Settings page, because two features drive it: the Settings MCP
 * dashboard and the agent config form, which registers a server and must then offer
 * authorization without sending the author out of the playground.
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {
    beginMcpConnect,
    buildTrustedOrigins,
    discoverMcpConnect,
    gatewayRefusalMessage,
    watchOauthConsent,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"
import {getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {randomAlphanumeric} from "@agenta/shared/utils"
import {EnhancedModal, ModalContent, ModalFooter, message} from "@agenta/ui"
import {Checkbox} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

export interface McpConnectDialogProps {
    endpoint: MCPEndpoint | null
    onClose: () => void
    onSuccess?: () => void
}

// Discover scopes before opening the OAuth authorization flow.
export default function McpConnectDialog({endpoint, onClose, onSuccess}: McpConnectDialogProps) {
    const projectId = useAtomValue(projectIdAtom)
    const [loading, setLoading] = useState(false)
    const [scopesOffered, setScopesOffered] = useState<string[]>([])
    const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set())
    const [discoverError, setDiscoverError] = useState<string | null>(null)

    // The consent watch outlives the call that starts it, so its teardown is held here rather
    // than in that closure: the agent config row unmounts this dialog on close, with the popup
    // still open, and an unreleased listener and poll would survive every reopen.
    const stopWatchRef = useRef<(() => void) | null>(null)
    // One window name per dialog instance. A shared name lets a second attempt reuse — and so
    // hijack — the first attempt's popup.
    const popupNameRef = useRef(`mcp_oauth_${randomAlphanumeric(6)}`)

    const open = !!endpoint

    const stopWatch = useCallback(() => {
        stopWatchRef.current?.()
        stopWatchRef.current = null
    }, [])

    useEffect(() => stopWatch, [stopWatch])

    useEffect(() => {
        if (!endpoint?.id) return
        setLoading(true)
        setDiscoverError(null)
        discoverMcpConnect(endpoint.id, projectId ?? undefined)
            .then((result) => {
                const scopes = result.scopes_offered ?? []
                setScopesOffered(scopes)
                setSelectedScopes(new Set(scopes)) // all pre-checked (D17)
            })
            .catch((error) => {
                // The server's own sentence when it wrote one. Axios's `message` is the
                // status line, so a refusal that explains itself was arriving as a number.
                setDiscoverError(
                    gatewayRefusalMessage(error) ||
                        "Could not discover this server's OAuth configuration.",
                )
            })
            .finally(() => setLoading(false))
    }, [endpoint?.id, projectId])

    const handleClose = useCallback(() => {
        stopWatch()
        setScopesOffered([])
        setSelectedScopes(new Set())
        setDiscoverError(null)
        setLoading(false)
        onClose()
    }, [onClose, stopWatch])

    const toggleScope = useCallback((scope: string) => {
        setSelectedScopes((prev) => {
            const next = new Set(prev)
            if (next.has(scope)) next.delete(scope)
            else next.add(scope)
            return next
        })
    }, [])

    const handleConnect = useCallback(async () => {
        if (!endpoint?.id) return
        try {
            setLoading(true)
            const result = await beginMcpConnect(
                endpoint.id,
                Array.from(selectedScopes),
                projectId ?? undefined,
            )
            const redirectUrl = result.redirect_url
            if (!redirectUrl) {
                throw new Error("No authorization URL returned.")
            }

            const popup = window.open(
                redirectUrl,
                popupNameRef.current,
                "width=600,height=700,popup=yes",
            )
            if (!popup) {
                setLoading(false)
                message.warning("Popup blocked. Redirecting in this tab.")
                window.location.assign(redirectUrl)
                return
            }

            // The callback page is served by the API, so the API's origin is the only one that
            // can legitimately post this completion. Trusting the app or web origin as well
            // widens it for no gain.
            const trustedOrigins = buildTrustedOrigins([getAgentaApiUrl()])

            stopWatch()
            stopWatchRef.current = watchOauthConsent({
                popup,
                endpointId: endpoint.id,
                trustedOrigins,
                target: window,
                onConnected: () => {
                    window.focus()
                    handleClose()
                    onSuccess?.()
                },
                onFailed: (reason) => {
                    setLoading(false)
                    setDiscoverError(reason)
                },
            })
        } catch (error) {
            setLoading(false)
            message.error(gatewayRefusalMessage(error) || "Failed to start the connection.")
        }
    }, [endpoint, selectedScopes, projectId, handleClose, onSuccess, stopWatch])

    return (
        <EnhancedModal
            open={open}
            onCancel={handleClose}
            title={endpoint ? `Connect to ${endpoint.name || endpoint.slug}` : "Connect"}
            footer={null}
            width={420}
            destroyOnClose
        >
            <ModalContent>
                {discoverError ? (
                    <p className="text-sm text-colorErrorText">{discoverError}</p>
                ) : (
                    <div className="flex flex-col gap-2">
                        <span className="text-sm text-colorTextDescription">
                            Choose which permissions to grant.
                        </span>
                        {scopesOffered.length === 0 && !loading ? (
                            <span className="text-sm text-colorTextDescription">
                                This server offers no scoped permissions.
                            </span>
                        ) : (
                            scopesOffered.map((scope) => (
                                <label key={scope} className="flex items-center gap-2 text-sm">
                                    <Checkbox
                                        checked={selectedScopes.has(scope)}
                                        onCheckedChange={() => toggleScope(scope)}
                                    />
                                    {scope}
                                </label>
                            ))
                        )}
                    </div>
                )}

                <ModalFooter
                    onCancel={handleClose}
                    onConfirm={handleConnect}
                    confirmLabel="Connect"
                    isLoading={loading}
                    canConfirm={!discoverError}
                />
            </ModalContent>
        </EnhancedModal>
    )
}
