import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {buildRunFrame, isFrameNavigated, SANDBOX_FLAGS} from "@agenta/entities/drive"
import {axios, getAgentaApiUrl} from "@agenta/shared/api"

import {pluginErrorMessage} from "./pluginErrorMessage"
import {pluginStub} from "./pluginStub"

export function PluginFrame({
    html,
    title,
    projectId,
    revisionId,
    operations,
}: {
    html: string
    title: string
    projectId: string
    revisionId: string
    operations: string[]
}) {
    const frame = useRef<HTMLIFrameElement>(null)
    const port = useRef<MessagePort | null>(null)
    const controllers = useRef(new Set<AbortController>())
    const [stopped, setStopped] = useState(false)
    const document = useMemo(() => buildRunFrame(pluginStub + html), [html])
    const close = useCallback(() => {
        port.current?.close()
        port.current = null
        for (const controller of controllers.current) controller.abort()
        controllers.current.clear()
    }, [])
    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (event.source === frame.current?.contentWindow && isFrameNavigated(event.data)) {
                close()
                setStopped(true)
            }
        }
        window.addEventListener("message", onMessage)
        return () => {
            window.removeEventListener("message", onMessage)
            close()
        }
    }, [close])
    const connect = () => {
        close()
        const channel = new MessageChannel()
        port.current = channel.port1
        channel.port1.onmessage = async ({data}) => {
            if (!data || typeof data.id !== "string") return
            const reply = (body: object) => channel.port1.postMessage({v: 1, id: data.id, ...body})
            if (
                data.v !== 1 ||
                data.method !== "plugin.call" ||
                !operations.includes(data.operation) ||
                !data.args ||
                typeof data.args !== "object" ||
                Array.isArray(data.args)
            ) {
                reply({ok: false, error: "Invalid plugin action."})
                return
            }
            const controller = new AbortController()
            controllers.current.add(controller)
            try {
                const response = await axios.post(
                    `${getAgentaApiUrl().replace(/\/api\/?$/, "")}/services/plugin/v0/invoke`,
                    {
                        references: {workflow_revision: {id: revisionId}},
                        data: {inputs: {operation: data.operation, args: data.args}},
                    },
                    {
                        params: {project_id: projectId},
                        headers: {Accept: "application/json"},
                        signal: controller.signal,
                    },
                )
                if (response.data.status?.code !== 200)
                    throw new Error(response.data.status?.message ?? "Plugin action failed.")
                reply({ok: true, result: response.data.data?.outputs ?? null})
            } catch (error) {
                if (!controller.signal.aborted) {
                    reply({ok: false, error: pluginErrorMessage(error)})
                }
            } finally {
                controllers.current.delete(controller)
            }
        }
        channel.port1.start()
        frame.current?.contentWindow?.postMessage(
            {
                v: 1,
                type: "hello",
                dir: "",
                canWrite: false,
                visible: true,
                tokens: {},
            },
            "*",
            [channel.port2],
        )
    }
    if (stopped)
        return (
            <p role="alert" className="p-6">
                The plugin page tried to navigate away. Reload the plugin to continue.
            </p>
        )
    return (
        <iframe
            ref={frame}
            title={title}
            sandbox={SANDBOX_FLAGS}
            srcDoc={document}
            onLoad={connect}
            className="h-full min-h-0 w-full flex-1 border-0 bg-background"
        />
    )
}
