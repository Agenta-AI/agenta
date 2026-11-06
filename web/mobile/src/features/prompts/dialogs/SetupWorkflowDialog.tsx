import {useEffect, useMemo, useState} from "react"

import {probeEndpointPath} from "@agenta/entities/shared/openapi"
import {appWorkflowsWithAgentFlagsAtom, createAppFromTemplate} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {removeTrailingSlash} from "@agenta/shared/utils"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Field,
    Input,
} from "@agenta/ui/ui"
import {CheckCircleIcon, LinkIcon, ScrollIcon, WarningCircleIcon} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {promptsCopy} from "../promptsCopy"

type ConnectionStatus = "idle" | "testing" | "success" | "failure"

const isHttpUrl = (value: string): boolean => {
    try {
        const {protocol} = new URL(value)
        return protocol === "http:" || protocol === "https:"
    } catch {
        return false
    }
}

/**
 * The /w "Set up workflow" form: an app backed by the user's own service. The URL is tested
 * against its `/health` route as it is typed, and Create waits for a test that passed. The new
 * app goes in the open folder, then opens in the playground.
 */
export const SetupWorkflowDialog = ({
    folderId,
    onClose,
    onCreated,
}: {
    folderId: string | null
    onClose: () => void
    onCreated: (appId: string, revisionId?: string) => void
}) => {
    const copy = promptsCopy.setupWorkflowDialog
    const projectId = useAtomValue(projectIdAtom)
    const apps = useAtomValue(appWorkflowsWithAgentFlagsAtom)
    const queryClient = useQueryClient()
    const [name, setName] = useState("")
    const [url, setUrl] = useState("")
    const [status, setStatus] = useState<ConnectionStatus>("idle")
    const [testRun, setTestRun] = useState(0)
    const [creating, setCreating] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const trimmedName = name.trim()
    const trimmedUrl = url.trim()
    const urlValid = isHttpUrl(trimmedUrl)
    const nameTaken = useMemo(() => {
        const wanted = trimmedName.toLowerCase()
        if (!wanted) return false
        return apps.some(
            (app) =>
                !app.deleted_at && (app.name ?? app.slug ?? "").toLowerCase().trim() === wanted,
        )
    }, [apps, trimmedName])

    // A new URL, or a click on Test connection, runs the test again. The last one wins.
    useEffect(() => {
        if (!urlValid) {
            setStatus("idle")
            return
        }
        const controller = new AbortController()
        setStatus("testing")
        const timer = setTimeout(() => {
            probeEndpointPath(trimmedUrl, {endpoint: "/health", signal: controller.signal})
                .then((result) => {
                    if (!controller.signal.aborted)
                        setStatus(result?.status ? "success" : "failure")
                })
                .catch(() => {
                    if (!controller.signal.aborted) setStatus("failure")
                })
        }, 100)
        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    }, [trimmedUrl, urlValid, testRun])

    const hint = !trimmedUrl
        ? copy.needUrl
        : !urlValid
          ? copy.invalidUrl
          : status !== "success"
            ? copy.needTest
            : null
    const canCreate =
        Boolean(trimmedName) && !nameTaken && status === "success" && !creating && !!projectId

    const create = async () => {
        if (!canCreate || !projectId) return
        setCreating(true)
        setError(null)
        try {
            const result = await createAppFromTemplate({
                projectId,
                appName: trimmedName,
                templateKey: "custom",
                serviceUrl: removeTrailingSlash(trimmedUrl),
                folderId,
                isCustomWorkflow: true,
            })
            void queryClient.invalidateQueries({queryKey: ["workflows"]})
            onClose()
            onCreated(result.appId, result.revisionId)
        } catch {
            setError(promptsCopy.failure.createWorkflow)
            setCreating(false)
        }
    }

    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next && !creating) onClose()
            }}
        >
            <DialogContent className="sm:max-w-[480px]">
                <form
                    className="flex flex-col gap-5"
                    onSubmit={(event) => {
                        event.preventDefault()
                        void create()
                    }}
                >
                    <DialogHeader>
                        <div className="flex items-center justify-between gap-3 pr-8">
                            <DialogTitle>{copy.title}</DialogTitle>
                            <Button asChild variant="outline" size="sm">
                                <a href={copy.tutorialHref} target="_blank" rel="noreferrer">
                                    <ScrollIcon size={14} />
                                    {copy.tutorial}
                                </a>
                            </Button>
                        </div>
                        <DialogDescription>{copy.description}</DialogDescription>
                    </DialogHeader>
                    <Field
                        label={copy.nameLabel}
                        required
                        size="sm"
                        error={nameTaken ? copy.nameTaken : undefined}
                    >
                        <Input
                            autoFocus
                            value={name}
                            placeholder={copy.namePlaceholder}
                            onChange={(event) => setName(event.target.value)}
                        />
                    </Field>
                    <Field label={copy.urlLabel} required size="sm">
                        <Input
                            value={url}
                            placeholder={copy.urlPlaceholder}
                            onChange={(event) => setUrl(event.target.value)}
                        />
                    </Field>
                    <div className="flex items-center gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={!urlValid || status === "testing"}
                            onClick={() => setTestRun((run) => run + 1)}
                        >
                            <LinkIcon size={14} />
                            {status === "testing" ? copy.testing : copy.testConnection}
                        </Button>
                        <span role="status" className="flex items-center gap-1.5 text-sm">
                            {status === "success" ? (
                                <>
                                    <CheckCircleIcon size={16} className="text-success" />
                                    <span className="text-muted-foreground">{copy.success}</span>
                                </>
                            ) : status === "failure" ? (
                                <>
                                    <WarningCircleIcon size={16} className="text-destructive" />
                                    <span className="text-muted-foreground">{copy.failure}</span>
                                </>
                            ) : null}
                        </span>
                    </div>
                    {error ? (
                        <p className="m-0 text-sm text-destructive">{error}</p>
                    ) : hint ? (
                        <p className="m-0 text-sm text-muted-foreground">{hint}</p>
                    ) : null}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={creating}
                            onClick={onClose}
                        >
                            {promptsCopy.cancel}
                        </Button>
                        <Button type="submit" disabled={!canCreate}>
                            {creating ? copy.creating : copy.create}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
