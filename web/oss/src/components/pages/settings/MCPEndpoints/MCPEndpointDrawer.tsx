import {useCallback, useEffect, useState} from "react"

import {EnhancedModal, ModalContent, ModalFooter, message} from "@agenta/ui"
import {
    Field,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import {useSetAtom} from "jotai"

import {MCPAuthMode, MCPEndpoint} from "@/oss/services/mcpEndpoints/types"
import {createMcpEndpointAtom, editMcpEndpointAtom} from "@/oss/state/mcpEndpoints/atoms"

interface Props {
    open: boolean
    endpoint?: MCPEndpoint | null
    onClose: () => void
    onSuccess?: () => void
}

const AUTH_MODES: {value: MCPAuthMode; label: string}[] = [
    {value: "none", label: "None"},
    {value: "api_key", label: "API key"},
    {value: "oauth", label: "OAuth"},
]

export default function MCPEndpointDrawer({open, endpoint, onClose, onSuccess}: Props) {
    const createEndpoint = useSetAtom(createMcpEndpointAtom)
    const editEndpoint = useSetAtom(editMcpEndpointAtom)

    const [loading, setLoading] = useState(false)
    const [slug, setSlug] = useState("")
    const [name, setName] = useState("")
    const [baseUrl, setBaseUrl] = useState("")
    const [authMode, setAuthMode] = useState<MCPAuthMode>("none")
    const [slugError, setSlugError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return
        setSlug(endpoint?.slug || "")
        setName(endpoint?.name || "")
        setBaseUrl(endpoint?.data.route.base_url || "")
        setAuthMode(endpoint?.auth_mode || "none")
        setSlugError(null)
        setLoading(false)
    }, [open, endpoint])

    const handleClose = useCallback(() => {
        setLoading(false)
        onClose()
    }, [onClose])

    const handleSubmit = useCallback(async () => {
        if (!slug.trim()) {
            setSlugError("Required")
            return
        }
        if (!baseUrl.trim()) {
            message.error("Server URL is required.")
            return
        }
        setSlugError(null)
        setLoading(true)
        try {
            if (endpoint) {
                if (!endpoint.id) return
                await editEndpoint({
                    id: endpoint.id,
                    name: name || slug,
                    auth_mode: authMode,
                    secret_id: endpoint.secret_id,
                    data: {...endpoint.data, route: {base_url: baseUrl}},
                })
            } else {
                await createEndpoint({
                    slug,
                    name: name || slug,
                    auth_mode: authMode,
                    data: {route: {base_url: baseUrl}},
                })
            }
            handleClose()
            onSuccess?.()
        } catch (error) {
            message.error((error as Error)?.message || "Failed to save the MCP server.")
        } finally {
            setLoading(false)
        }
    }, [
        slug,
        name,
        baseUrl,
        authMode,
        endpoint,
        createEndpoint,
        editEndpoint,
        handleClose,
        onSuccess,
    ])

    return (
        <EnhancedModal
            open={open}
            onCancel={handleClose}
            title={endpoint ? "Edit MCP server" : "Register MCP server"}
            footer={null}
            width={480}
            destroyOnClose
        >
            <ModalContent>
                <div className="flex flex-col gap-4">
                    <Field label="Name">
                        <Input
                            placeholder="e.g. Acme Notion"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </Field>
                    <Field label="Slug" required error={slugError}>
                        <Input
                            placeholder="e.g. acme-notion"
                            value={slug}
                            disabled={!!endpoint}
                            onChange={(e) => {
                                setSlug(e.target.value)
                                if (slugError && e.target.value.trim()) setSlugError(null)
                            }}
                        />
                    </Field>
                    <Field label="Server URL" required tooltip="The MCP server's base URL">
                        <Input
                            placeholder="https://mcp.example.com"
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                        />
                    </Field>
                    <Field label="Authentication">
                        <Select
                            value={authMode}
                            onValueChange={(v) => setAuthMode(v as MCPAuthMode)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {AUTH_MODES.map((mode) => (
                                    <SelectItem key={mode.value} value={mode.value}>
                                        {mode.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                </div>

                <ModalFooter
                    onCancel={handleClose}
                    onConfirm={handleSubmit}
                    confirmLabel={endpoint ? "Save" : "Register"}
                    isLoading={loading}
                />
            </ModalContent>
        </EnhancedModal>
    )
}
