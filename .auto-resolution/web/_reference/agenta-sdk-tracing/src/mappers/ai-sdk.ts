/**
 * Agenta SDK Tracing — Vercel AI SDK v6 Mapper.
 *
 * Maps AI SDK's OTel span attributes to Agenta's ag.* conventions.
 * Returns new attributes — does NOT mutate the original span.
 */

import type {ReadableSpan} from "@opentelemetry/sdk-trace-base"

import {readAttrs, toJson, inferProvider} from "./shared-utils"
import type {FrameworkMapper} from "./types"

export const aiSdkMapper: FrameworkMapper = {
    id: "ai-sdk",

    detect(span: ReadableSpan): boolean {
        const name = span.name
        return (
            name.startsWith("ai.streamText") ||
            name.startsWith("ai.generateText") ||
            name.startsWith("ai.toolCall") ||
            name.startsWith("ai.embed") ||
            span.attributes["ai.model.id"] !== undefined ||
            span.attributes["ai.telemetry.functionId"] !== undefined
        )
    },

    mapAttributes(span: ReadableSpan): Record<string, unknown> {
        const attrs = readAttrs(span)
        const result: Record<string, unknown> = {}

        // ── Token metrics ──
        const promptTokens =
            attrs["gen_ai.usage.prompt_tokens"] ??
            attrs["gen_ai.usage.input_tokens"] ??
            attrs["ai.usage.promptTokens"]
        const completionTokens =
            attrs["gen_ai.usage.completion_tokens"] ??
            attrs["gen_ai.usage.output_tokens"] ??
            attrs["ai.usage.completionTokens"]

        if (promptTokens !== undefined)
            result["ag.metrics.tokens.incremental.prompt"] = Number(promptTokens)
        if (completionTokens !== undefined)
            result["ag.metrics.tokens.incremental.completion"] = Number(completionTokens)
        if (promptTokens !== undefined && completionTokens !== undefined)
            result["ag.metrics.tokens.incremental.total"] =
                Number(promptTokens) + Number(completionTokens)

        // ── Model metadata ──
        const model =
            attrs["gen_ai.request.model"] ?? attrs["ai.model.id"] ?? attrs["gen_ai.response.model"]
        if (model) {
            result["ag.meta.request.model"] = String(model)
            const provider = inferProvider(String(model))
            if (provider) result["ag.meta.system"] = provider
        }

        // ── Streaming flag ──
        const spanName = span.name
        if (spanName.startsWith("ai.streamText")) result["ag.meta.request.streaming"] = true

        // ── Span type + content ──
        if (spanName.startsWith("ai.streamText") || spanName.startsWith("ai.generateText")) {
            result["ag.type.node"] = "chat"

            const prompt = attrs["ai.prompt.messages"] ?? attrs["ai.prompt"]
            if (prompt !== undefined) {
                try {
                    const parsed = typeof prompt === "string" ? JSON.parse(prompt) : prompt
                    result["ag.data.inputs"] = toJson({prompt: parsed})
                } catch {
                    result["ag.data.inputs"] = toJson({prompt})
                }
            } else {
                result["ag.data.inputs"] = toJson({prompt: [], streaming: true})
            }

            const response = attrs["ai.response.text"]
            let outputObj: Record<string, unknown> = {}
            if (response !== undefined) {
                outputObj = {completion: [{role: "assistant", content: String(response)}]}
            } else {
                outputObj = {completion: []}
            }

            const toolCalls = attrs["ai.response.toolCalls"]
            if (toolCalls !== undefined) {
                try {
                    outputObj.toolCalls =
                        typeof toolCalls === "string" ? JSON.parse(toolCalls) : toolCalls
                } catch {
                    /* skip */
                }
            }
            result["ag.data.outputs"] = toJson(outputObj)
        } else if (spanName.startsWith("ai.toolCall")) {
            result["ag.type.node"] = "tool"

            const resolvedName =
                attrs["ai.toolCall.name"] ??
                attrs["gen_ai.tool.name"] ??
                attrs["ai.tool.name"] ??
                attrs["ai.toolCall.toolName"]
            const toolArgs = attrs["ai.toolCall.args"] ?? attrs["ai.tool.call.args"]
            const toolResult = attrs["ai.toolCall.result"] ?? attrs["ai.tool.call.result"]
            const nameFromSpan = spanName.startsWith("ai.toolCall ")
                ? spanName.slice("ai.toolCall ".length)
                : undefined

            if (toolArgs !== undefined) {
                try {
                    result["ag.data.inputs"] = toJson(
                        typeof toolArgs === "string" ? JSON.parse(toolArgs) : toolArgs,
                    )
                } catch {
                    result["ag.data.inputs"] = toJson({args: toolArgs})
                }
            }
            if (toolResult !== undefined) {
                try {
                    result["ag.data.outputs"] = toJson(
                        typeof toolResult === "string" ? JSON.parse(toolResult) : toolResult,
                    )
                } catch {
                    result["ag.data.outputs"] = toJson({result: toolResult})
                }
            }
            const finalName = resolvedName ?? nameFromSpan
            if (finalName && !attrs["ai.toolCall.name"])
                result["ai.toolCall.name"] = String(finalName)
        } else if (spanName.startsWith("ai.embed")) {
            result["ag.type.node"] = "embedding"
        }

        // ── Session ──
        const sessionId = attrs["ai.telemetry.metadata.sessionId"] ?? attrs["ag.session.id"]
        if (sessionId) result["ag.session.id"] = String(sessionId)

        // ── User ──
        const userId = attrs["ai.telemetry.metadata.userId"]
        if (userId) result["ag.meta.userId"] = String(userId)

        // ── App references ──
        const appId = attrs["ai.telemetry.metadata.applicationId"]
        const appRevId = attrs["ai.telemetry.metadata.applicationRevisionId"]
        if (appId) result["ag.refs.application.id"] = String(appId)
        if (appRevId) result["ag.refs.application_revision.id"] = String(appRevId)

        return result
    },
}
