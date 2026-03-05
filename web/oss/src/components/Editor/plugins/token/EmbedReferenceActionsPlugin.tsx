import {useCallback, useEffect, useMemo, useState} from "react"

import {FloatingPortal, autoUpdate, flip, offset, shift, useFloating} from "@floating-ui/react"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useRouter} from "next/router"

import axios from "@/oss/lib/api/assets/axiosConfig"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"

type EmbedKind = "workflow" | "application" | "evaluator" | "environment"

type ParsedEmbed = {
    kind: EmbedKind
    slug: string
    revision?: string
    key?: string
}

const parseEmbedToken = (tokenText: string): ParsedEmbed | null => {
    if (!tokenText.startsWith("@{{") || !tokenText.endsWith("}}")) return null
    const raw = tokenText.slice(3, -2).trim()
    if (!raw) return null

    const parts = raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)

    const readValue = (prefix: string) => {
        const part = parts.find((item) => item.startsWith(prefix))
        if (!part) return null
        const value = part.slice(prefix.length).trim()
        return value || null
    }

    const workflowPart = readValue("workflow.slug=")
    if (workflowPart) {
        const revision =
            readValue("workflow.revision=") ??
            readValue("workflow_revision=") ??
            readValue("revision=") ??
            undefined
        return {kind: "workflow", slug: workflowPart, revision: revision ?? undefined}
    }

    const applicationPart = readValue("application.slug=")
    if (applicationPart) {
        const revision =
            readValue("application.revision=") ??
            readValue("application_revision=") ??
            readValue("revision=") ??
            undefined
        return {kind: "application", slug: applicationPart, revision: revision ?? undefined}
    }

    const evaluatorPart = readValue("evaluator.slug=")
    if (evaluatorPart) {
        const revision =
            readValue("evaluator.revision=") ??
            readValue("evaluator_revision=") ??
            readValue("revision=") ??
            undefined
        return {kind: "evaluator", slug: evaluatorPart, revision: revision ?? undefined}
    }

    const environmentPart = readValue("environment.slug=")
    if (environmentPart) {
        const key = readValue("key=") ?? undefined
        return {kind: "environment", slug: environmentPart, key}
    }

    return null
}

const EmbedReferenceActionsPlugin = (): null => {
    const [editor] = useLexicalComposerContext()
    const router = useRouter()
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
    const [parsedEmbed, setParsedEmbed] = useState<ParsedEmbed | null>(null)
    const [isResolving, setIsResolving] = useState(false)

    const {refs, floatingStyles} = useFloating({
        open: Boolean(anchorEl && parsedEmbed),
        whileElementsMounted: autoUpdate,
        placement: "top-start",
        middleware: [offset(8), flip(), shift({padding: 8})],
    })

    useEffect(() => {
        refs.setReference(anchorEl)
    }, [anchorEl, refs])

    const workspaceId = useMemo(() => {
        const raw = router.query.workspace_id
        return Array.isArray(raw) ? raw[0] : raw
    }, [router.query.workspace_id])

    const projectId = useMemo(() => {
        const raw = router.query.project_id
        return Array.isArray(raw) ? raw[0] : raw
    }, [router.query.project_id])

    const appId = useMemo(() => {
        const raw = router.query.app_id
        return Array.isArray(raw) ? raw[0] : raw
    }, [router.query.app_id])

    const projectURL = useMemo(() => {
        if (!workspaceId || !projectId) return null
        return `/w/${workspaceId}/p/${projectId}`
    }, [workspaceId, projectId])

    const closeMenu = useCallback(() => {
        setAnchorEl(null)
        setParsedEmbed(null)
        setIsResolving(false)
    }, [])

    useEffect(() => {
        const root = editor.getRootElement()
        if (!root) return

        const handleClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null
            const tokenNode = target?.closest(".token-node") as HTMLElement | null
            if (!tokenNode) return

            const text = tokenNode.textContent?.trim() || ""
            const parsed = parseEmbedToken(text)
            if (!parsed) return

            event.preventDefault()
            event.stopPropagation()
            setAnchorEl(tokenNode)
            setParsedEmbed(parsed)
        }

        const handleOutside = (event: MouseEvent) => {
            const target = event.target as Node | null
            const floating = refs.floating.current
            if (!target) return
            if (anchorEl?.contains(target as Node)) return
            if (floating?.contains(target as Node)) return
            closeMenu()
        }

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") closeMenu()
        }

        root.addEventListener("click", handleClick, true)
        document.addEventListener("mousedown", handleOutside, true)
        document.addEventListener("keydown", handleEscape)

        return () => {
            root.removeEventListener("click", handleClick, true)
            document.removeEventListener("mousedown", handleOutside, true)
            document.removeEventListener("keydown", handleEscape)
        }
    }, [editor, anchorEl, refs.floating, closeMenu])

    const openReference = useCallback(async () => {
        if (!parsedEmbed || !projectURL) return

        if (!projectId) return
        setIsResolving(true)
        try {
            let target = `${projectURL}/apps`

            if (parsedEmbed.kind === "environment") {
                let response: any
                try {
                    response = await axios.post(
                        "/preview/environments/revisions/retrieve",
                        {
                            environment_ref: {slug: parsedEmbed.slug},
                            resolve: false,
                        },
                        {
                            params: {project_id: projectId},
                            _ignoreError: true,
                        } as any,
                    )
                } catch {
                    // Backward-compatible fallback for stacks exposing this route outside preview
                    response = await axios.post(
                        "/environments/revisions/retrieve",
                        {
                            environment_ref: {slug: parsedEmbed.slug},
                            resolve: false,
                        },
                        {
                            params: {project_id: projectId},
                            _ignoreError: true,
                        } as any,
                    )
                }
                const revision = response?.data?.environment_revision ?? null
                const references = (revision?.data?.references ?? {}) as Record<string, any>
                const referenceKey = parsedEmbed.key ?? Object.keys(references)[0] ?? null
                const targetReference = referenceKey ? references?.[referenceKey] : null

                const resolvedAppId =
                    targetReference?.application?.id ??
                    targetReference?.application_id ??
                    appId ??
                    null
                const resolvedRevisionId =
                    targetReference?.application_revision?.id ??
                    targetReference?.application_revision_id ??
                    null

                target = resolvedAppId
                    ? `${projectURL}/apps/${resolvedAppId}/variants?tab=deployments&selectedEnvName=${encodeURIComponent(parsedEmbed.slug)}${resolvedRevisionId ? `&revisionId=${encodeURIComponent(resolvedRevisionId)}` : ""}&drawerType=deployment`
                    : `${projectURL}/apps`
            } else if (parsedEmbed.kind === "workflow") {
                const response = await axios.post(
                    "/workflows/revisions/retrieve",
                    {
                        workflow_ref: {slug: parsedEmbed.slug},
                        workflow_revision_ref: parsedEmbed.revision
                            ? {id: parsedEmbed.revision, slug: parsedEmbed.revision}
                            : undefined,
                        resolve: false,
                    },
                    {
                        params: {project_id: projectId},
                        _ignoreError: true,
                    } as any,
                )
                const revision = response?.data?.workflow_revision ?? null
                const targetId =
                    revision?.workflow_id ?? revision?.artifact_id ?? revision?.workflowId ?? null
                const revisionId =
                    revision?.id ??
                    revision?.workflow_revision_id ??
                    revision?.workflowRevisionId ??
                    parsedEmbed.revision ??
                    null
                target = targetId
                    ? `${projectURL}/apps/${targetId}/playground${revisionId ? `?revisions=${encodeURIComponent(revisionId)}` : ""}`
                    : appId
                      ? `${projectURL}/apps/${appId}/playground`
                      : `${projectURL}/apps`
            } else if (parsedEmbed.kind === "application") {
                const response = await axios.post(
                    "/applications/revisions/retrieve",
                    {
                        application_ref: {slug: parsedEmbed.slug},
                        application_revision_ref: parsedEmbed.revision
                            ? {id: parsedEmbed.revision, slug: parsedEmbed.revision}
                            : undefined,
                        resolve: false,
                    },
                    {
                        params: {project_id: projectId},
                        _ignoreError: true,
                    } as any,
                )
                const revision = response?.data?.application_revision ?? null
                const targetId =
                    revision?.application_id ??
                    revision?.artifact_id ??
                    revision?.applicationId ??
                    null
                const revisionId =
                    revision?.id ??
                    revision?.application_revision_id ??
                    revision?.applicationRevisionId ??
                    parsedEmbed.revision ??
                    null
                target = targetId
                    ? `${projectURL}/apps/${targetId}/playground${revisionId ? `?revisions=${encodeURIComponent(revisionId)}` : ""}`
                    : appId
                      ? `${projectURL}/apps/${appId}/playground`
                      : `${projectURL}/apps`
            } else if (parsedEmbed.kind === "evaluator") {
                const response = await axios.post(
                    "/evaluators/revisions/retrieve",
                    {
                        evaluator_ref: {slug: parsedEmbed.slug},
                        evaluator_revision_ref: parsedEmbed.revision
                            ? {id: parsedEmbed.revision, slug: parsedEmbed.revision}
                            : undefined,
                        resolve: false,
                    },
                    {
                        params: {project_id: projectId},
                        _ignoreError: true,
                    } as any,
                )
                const revision = response?.data?.evaluator_revision ?? null
                const targetId =
                    revision?.evaluator_id ??
                    revision?.artifact_id ??
                    revision?.evaluatorId ??
                    null
                const revisionId =
                    revision?.id ??
                    revision?.evaluator_revision_id ??
                    revision?.evaluatorRevisionId ??
                    parsedEmbed.revision ??
                    null
                target = targetId
                    ? `${projectURL}/evaluators/configure/${targetId}${revisionId ? `?revisions=${encodeURIComponent(revisionId)}` : ""}`
                    : `${projectURL}/evaluators`
            }

            window.open(target, "_blank", "noopener,noreferrer")
        } finally {
            setIsResolving(false)
            closeMenu()
        }
    }, [parsedEmbed, projectURL, appId, projectId, closeMenu])

    if (!anchorEl || !parsedEmbed) return null

    const cta =
        parsedEmbed.kind === "environment"
            ? "Open environment in registry"
            : parsedEmbed.kind === "evaluator"
              ? "Open evaluator in configure view"
              : "Open in playground"
    const buttonLabel =
        parsedEmbed.kind === "environment" ? "Open in Registry" : "Open in Playground"
    
    return (
        <FloatingPortal>
            <div ref={refs.setFloating} style={floatingStyles} className="z-[1200]">
                <Tooltip title={cta}>
                    <Button
                        size="small"
                        type="default"
                        icon={<ArrowSquareOut size={16} />}
                        onClick={openReference}
                        loading={isResolving}
                        className="!h-7 !rounded-md !bg-white !border-[#C9D4DF] !text-[#223548] hover:!bg-[#F7FAFC] !shadow-none"
                    >
                        {buttonLabel}
                    </Button>
                </Tooltip>
            </div>
        </FloatingPortal>
    )
}

export default EmbedReferenceActionsPlugin
