import {useCallback, useEffect, useState} from "react"

import {EnhancedModal, ModalContent, ModalFooter, message} from "@agenta/ui"
import {Checkbox} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {getAgentaApiUrl, getAgentaWebUrl} from "@/oss/lib/helpers/api"
import {beginMcpConnect, discoverMcpConnect} from "@/oss/services/mcpEndpoints/api"
import {MCPEndpoint} from "@/oss/services/mcpEndpoints/types"
import {projectIdAtom} from "@/oss/state/project"

import {
    buildTrustedOrigins,
    isTrustedOauthConnectedMessage,
    McpOauthCompletionMessage,
} from "./connectMessage"

interface Props {
    endpoint: MCPEndpoint | null
    onClose: () => void
    onSuccess?: () => void
}

// Discover scopes before opening the OAuth authorization flow.
export default function MCPConnectDialog({endpoint, onClose, onSuccess}: Props) {
    const projectId = useAtomValue(projectIdAtom)
    const [loading, setLoading] = useState(false)
    const [scopesOffered, setScopesOffered] = useState<string[]>([])
    const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set())
    const [discoverError, setDiscoverError] = useState<string | null>(null)

    const open = !!endpoint

    useEffect(() => {
        if (!endpoint) return
        setLoading(true)
        setDiscoverError(null)
        discoverMcpConnect(endpoint.id, projectId ?? undefined)
            .then((result) => {
                const scopes = result.scopes_offered ?? []
                setScopesOffered(scopes)
                setSelectedScopes(new Set(scopes)) // all pre-checked (D17)
            })
            .catch((error) => {
                setDiscoverError(
                    error?.message || "Could not discover this server's OAuth configuration.",
                )
            })
            .finally(() => setLoading(false))
    }, [endpoint?.id, projectId])

    const handleClose = useCallback(() => {
        setScopesOffered([])
        setSelectedScopes(new Set())
        setDiscoverError(null)
        setLoading(false)
        onClose()
    }, [onClose])

    const toggleScope = useCallback((scope: string) => {
        setSelectedScopes((prev) => {
            const next = new Set(prev)
            if (next.has(scope)) next.delete(scope)
            else next.add(scope)
            return next
        })
    }, [])

    const handleConnect = useCallback(async () => {
        if (!endpoint) return
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

            const popup = window.open(redirectUrl, "mcp_oauth", "width=600,height=700,popup=yes")
            if (!popup) {
                setLoading(false)
                message.warning("Popup blocked. Redirecting in this tab.")
                window.location.assign(redirectUrl)
                return
            }

            let finished = false
            let pollTimer: ReturnType<typeof setInterval> | undefined
            const cleanup = (handler: (event: MessageEvent) => void) => {
                if (finished) return false
                finished = true
                window.removeEventListener("message", handler)
                if (pollTimer) clearInterval(pollTimer)
                return true
            }

            const onAuthDone = () => {
                window.focus()
                handleClose()
                onSuccess?.()
            }

            const trustedOrigins = buildTrustedOrigins([
                window.location.origin,
                getAgentaApiUrl(),
                getAgentaWebUrl(),
            ])

            const handler = (event: MessageEvent) => {
                if (isTrustedOauthConnectedMessage(event.data, event.origin, trustedOrigins)) {
                    const completion = event.data as McpOauthCompletionMessage
                    if (completion.endpoint_id && completion.endpoint_id !== endpoint.id) return
                    if (!cleanup(handler)) return
                    if (completion.success) {
                        onAuthDone()
                    } else {
                        setLoading(false)
                        setDiscoverError(completion.error || "Authorization was not completed.")
                    }
                }
            }
            window.addEventListener("message", handler)

            pollTimer = setInterval(() => {
                if (popup && popup.closed) {
                    // A manually closed authorization window is not proof that the
                    // callback exchanged a code. Only the typed callback message
                    // above may move the dashboard to success.
                    if (cleanup(handler)) {
                        setLoading(false)
                        setDiscoverError("Authorization window closed before completion.")
                    }
                }
            }, 1000)
        } catch (error) {
            setLoading(false)
            message.error((error as Error)?.message || "Failed to start the connection.")
        }
    }, [endpoint, selectedScopes, projectId, handleClose, onSuccess])

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
