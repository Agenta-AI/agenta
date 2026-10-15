import {useCallback, useEffect, useRef, useState} from "react"

import {AttachmentUploadError, uploadAttachment} from "@agenta/chat/assets"
import {
    abandonAgentTemplateLoad,
    agentTemplateLoadRecovery,
    agentTemplateSourceKey,
    parseAgentTemplateError,
    validateAgentTemplate,
    type AgentTemplateLoadRecovery,
    type AgentTemplateRequestError,
    type AgentTemplateSource,
    type AgentTemplateValidationIssue,
} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {generateId} from "@agenta/shared/utils"
import {useAtomValue} from "jotai"

import {pickTemplateZip} from "./pickTemplateZip"
import {useCreateAgent, type CreatedAgent} from "./useCreateAgent"

/** Where the import starts: a zip the user picked, or a zip in a session's files. */
export type TemplateImportStart =
    | {kind: "upload"; file: File}
    | {kind: "session_file"; sessionId: string; path: string}

/** A source the validate call accepted, pinned to the bytes it checked where the source is mutable. */
export interface CheckedTemplate {
    source: AgentTemplateSource
    version: string
    /** The file name the user picked. */
    label: string
}

export type TemplateImportState =
    | {at: "pick"; fileProblem?: string}
    | {at: "checking"; step: "uploading" | "validating"; label: string}
    | {at: "invalid"; label: string; issue: AgentTemplateValidationIssue}
    | {at: "check_failed"; label: string; error: AgentTemplateRequestError}
    | {at: "ready"; checked: CheckedTemplate}
    | {at: "creating"; checked: CheckedTemplate}
    | {
          at: "create_failed"
          checked: CheckedTemplate
          error: AgentTemplateRequestError
          recovery: AgentTemplateLoadRecovery
      }

const ARCHIVE_MAX_BYTES = 5 * 1024 * 1024

/** Why a picked file can't be a template zip (checked before upload), or null. */
const archiveProblem = (file: File): string | null => {
    if (!file.name.toLowerCase().endsWith(".zip")) return "Choose a .zip file."
    if (file.size > ARCHIVE_MAX_BYTES)
        return "This zip is larger than 5 MB. Remove large files, then build the zip again."
    if (file.size === 0) return "This zip is empty."
    return null
}

const fileName = (path: string) => path.split("/").pop() || path

const sessionFileSource = (start: {sessionId: string; path: string}): AgentTemplateSource => ({
    kind: "session_file",
    session_id: start.sessionId,
    path: start.path,
})

interface CreateFailure {
    message: string
    error: unknown
}

/** One import: pick, validate, then load; a failed load keeps its Idempotency-Key for Try again. */
export const useTemplateImport = ({
    start,
    onCreated,
}: {
    start: TemplateImportStart
    onCreated: (agent: CreatedAgent) => void
}) => {
    const projectId = useAtomValue(projectIdAtom)
    const [state, setState] = useState<TemplateImportState>(() =>
        start.kind === "session_file"
            ? {
                  at: "checking",
                  step: "validating",
                  label: fileName(start.path),
              }
            : start.kind === "upload"
              ? {at: "checking", step: "uploading", label: start.file.name}
              : {at: "pick"},
    )
    // One staging session holds every zip this import uploads.
    const [stagingSessionId] = useState(generateId)
    // A newer check (or a close) makes an older check's answer stale.
    const generation = useRef(0)
    const lastError = useRef<CreateFailure | null>(null)
    const recordError = useCallback((message: string, error?: unknown) => {
        lastError.current = {message, error}
    }, [])
    const createAgent = useCreateAgent({onError: recordError})

    const validate = useCallback(
        async (source: AgentTemplateSource, label: string, run: number) => {
            try {
                const result = await validateAgentTemplate(source, projectId ?? "")
                if (run !== generation.current) return
                if (result?.valid && result.version && result.digest) {
                    const pinned: AgentTemplateSource =
                        source.kind === "session_file"
                            ? {...source, pin: {version: result.version, digest: result.digest}}
                            : source
                    setState({
                        at: "ready",
                        checked: {source: pinned, version: result.version, label},
                    })
                } else if (result && !result.valid && result.issues[0]) {
                    setState({at: "invalid", label, issue: result.issues[0]})
                } else {
                    setState({
                        at: "check_failed",
                        label,
                        error: {
                            ...parseAgentTemplateError(undefined),
                            code: "unexpected_response",
                            message: "Agenta returned an answer this app can't read.",
                        },
                    })
                }
            } catch (error) {
                if (run !== generation.current) return
                const parsed = parseAgentTemplateError(error)
                setState({at: "check_failed", label, error: parsed})
            }
        },
        [projectId],
    )

    const checkFile = useCallback(
        async (file: File) => {
            const problem = archiveProblem(file)
            if (problem) {
                setState({at: "pick", fileProblem: problem})
                return
            }
            const run = ++generation.current
            setState({at: "checking", step: "uploading", label: file.name})
            let attachmentId: string
            try {
                const uploaded = await uploadAttachment({
                    file,
                    sessionId: stagingSessionId,
                    projectId: projectId ?? "",
                    idempotencyKey: generateId(),
                })
                attachmentId = uploaded.attachment.attachment_id
            } catch (error) {
                if (run !== generation.current) return
                setState({
                    at: "check_failed",
                    label: file.name,
                    error: {
                        ...parseAgentTemplateError(undefined),
                        code: "upload_failed",
                        message:
                            error instanceof Error && error.message
                                ? error.message
                                : "Couldn't upload the file. Try again.",
                        nextStep:
                            error instanceof AttachmentUploadError && !error.retryable
                                ? "Choose another file, or build the zip again from the package folder."
                                : null,
                    },
                })
                return
            }
            if (run !== generation.current) return
            setState({at: "checking", step: "validating", label: file.name})
            await validate(
                {kind: "upload", staging_session_id: stagingSessionId, attachment_id: attachmentId},
                file.name,
                run,
            )
        },
        [projectId, stagingSessionId, validate],
    )

    const checkSessionFile = useCallback(async () => {
        if (start.kind !== "session_file") return
        const run = ++generation.current
        const source = sessionFileSource(start)
        const label = fileName(start.path)
        setState({at: "checking", step: "validating", label})
        await validate(source, label, run)
    }, [start, validate])

    // StrictMode runs mount effects twice; check the picked source once.
    const started = useRef(false)
    useEffect(() => {
        if (started.current) return
        started.current = true
        if (start.kind === "session_file") void checkSessionFile()
        if (start.kind === "upload") void checkFile(start.file)
    }, [])

    /** Drop the saved request so the next Create sends a new Idempotency-Key. */
    const forget = useCallback(
        (checked: CheckedTemplate) => {
            if (projectId)
                abandonAgentTemplateLoad(projectId, agentTemplateSourceKey(checked.source))
        },
        [projectId],
    )

    const busy = useRef(false)
    const create = useCallback(
        async (checked: CheckedTemplate, initialMessage: string) => {
            if (busy.current) return
            busy.current = true
            lastError.current = null
            setState({at: "creating", checked})
            try {
                const agent = await createAgent({source: checked.source, initialMessage})
                if (agent) {
                    onCreated(agent)
                    return
                }
                // onError writes the ref during the await; TS still sees the null set above.
                const failure = lastError.current as CreateFailure | null
                if (!failure) {
                    // Another create on this page holds the latch; nothing was sent.
                    setState({at: "ready", checked})
                    return
                }
                const parsed = parseAgentTemplateError(failure.error)
                // No HTTP response: keep the creator's own message, not a generic network one.
                const error =
                    parsed.status === null ? {...parsed, message: failure.message} : parsed
                const recovery = agentTemplateLoadRecovery(error)
                // Nothing was created, so the saved request has nothing left to replay.
                if (recovery === "edit_source" || recovery === "check_again") forget(checked)
                setState({at: "create_failed", checked, error, recovery})
            } finally {
                busy.current = false
            }
        },
        [createAgent, forget, onCreated],
    )

    /** Back to the source: a new zip from the picker, or the session file checked again. */
    const back = useCallback(async () => {
        if (start.kind === "session_file") {
            void checkSessionFile()
            return
        }
        const file = await pickTemplateZip()
        if (file) void checkFile(file)
    }, [checkFile, checkSessionFile, start.kind])

    const startOver = useCallback(
        (checked: CheckedTemplate) => {
            forget(checked)
            setState({at: "ready", checked})
        },
        [forget],
    )

    /** The dialog is closing: stale any check in flight and forget a request that surely failed. */
    const dispose = useCallback(() => {
        generation.current += 1
        // An unknown outcome keeps its key: importing the same source again replays, not duplicates.
        if (state.at === "create_failed" && state.recovery === "start_over") forget(state.checked)
    }, [forget, state])

    return {state, create, back, startOver, dispose}
}
