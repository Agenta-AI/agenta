/**
 * Agenta SDK Tracing — Mastra Framework Mapper.
 *
 * Maps Mastra's OTel span attributes to Agenta's ag.* conventions.
 *
 * Mastra uses OpenTelemetry GenAI Semantic Conventions v1.38.0:
 *   gen_ai.operation.name   — "chat", "execute_tool", "invoke_agent", "invoke_workflow"
 *   gen_ai.request.model    — Model identifier
 *   gen_ai.provider.name    — AI provider (e.g., "openai", "anthropic")
 *   gen_ai.usage.input_tokens, gen_ai.usage.output_tokens
 *   gen_ai.input.messages   — Chat history/prompt messages
 *   gen_ai.output.messages  — Model response messages
 *   gen_ai.tool.name, gen_ai.tool.call.arguments, gen_ai.tool.call.result
 *   gen_ai.agent.id, gen_ai.agent.name
 *   gen_ai.conversation.id  — Session/conversation ID
 *   mastra.metadata.*, mastra.tags — Custom metadata
 *
 * Span name patterns:
 *   "chat {model}"          — LLM generation
 *   "execute_tool {name}"   — Tool execution
 *   "invoke_agent {id}"     — Agent run
 *   "invoke_workflow {id}"  — Workflow run
 */

import type {ReadableSpan} from "@opentelemetry/sdk-trace-base"

import {readAttrs, toJson, inferProvider} from "./shared-utils"
import type {FrameworkMapper} from "./types"

export const mastraMapper: FrameworkMapper = {
    id: "mastra",

    detect(span: ReadableSpan): boolean {
        const attrs = span.attributes
        // Mastra spans have gen_ai.operation.name attribute
        if (attrs["gen_ai.operation.name"] !== undefined) return true
        // Or mastra-specific attributes
        if (attrs["mastra.tags"] !== undefined) return true
        // Or span name matches Mastra patterns (but NOT AI SDK patterns)
        const name = span.name
        if (
            name.startsWith("chat ") ||
            name.startsWith("execute_tool ") ||
            name.startsWith("invoke_agent ") ||
            name.startsWith("invoke_workflow ")
        ) {
            return true
        }
        // Check for mastra metadata attributes
        for (const key of Object.keys(attrs)) {
            if (key.startsWith("mastra.metadata.")) return true
        }
        return false
    },

    mapAttributes(span: ReadableSpan): Record<string, unknown> {
        const attrs = readAttrs(span)
        const m: Record<string, unknown> = {}
        const operation = attrs["gen_ai.operation.name"] as string | undefined
        const spanName = span.name

        // ── Token metrics ──
        const promptTokens =
            attrs["gen_ai.usage.input_tokens"] ?? attrs["gen_ai.usage.prompt_tokens"]
        const completionTokens =
            attrs["gen_ai.usage.output_tokens"] ?? attrs["gen_ai.usage.completion_tokens"]

        if (promptTokens !== undefined)
            m["ag.metrics.tokens.incremental.prompt"] = Number(promptTokens)
        if (completionTokens !== undefined)
            m["ag.metrics.tokens.incremental.completion"] = Number(completionTokens)
        if (promptTokens !== undefined && completionTokens !== undefined)
            m["ag.metrics.tokens.incremental.total"] =
                Number(promptTokens) + Number(completionTokens)

        // ── Model metadata ──
        const model = attrs["gen_ai.request.model"] ?? attrs["gen_ai.response.model"]
        if (model) {
            m["ag.meta.request.model"] = String(model)
        }

        // ── Provider / system ──
        const provider = attrs["gen_ai.provider.name"] as string | undefined
        if (provider) {
            // Mastra provides the provider name directly
            m["ag.meta.system"] = provider
        } else if (model) {
            const inferred = inferProvider(String(model))
            if (inferred) m["ag.meta.system"] = inferred
        }

        // ── Temperature ──
        const temperature = attrs["gen_ai.request.temperature"]
        if (temperature !== undefined) m["ag.meta.request.temperature"] = Number(temperature)

        // ── Span type + content ──
        if (operation === "chat" || spanName.startsWith("chat ")) {
            // MODEL_GENERATION — LLM call
            m["ag.type.node"] = "chat"

            const inputMessages = attrs["gen_ai.input.messages"]
            if (inputMessages !== undefined) {
                try {
                    const parsed =
                        typeof inputMessages === "string"
                            ? JSON.parse(inputMessages)
                            : inputMessages
                    m["ag.data.inputs"] = toJson({prompt: parsed})
                } catch {
                    m["ag.data.inputs"] = toJson({prompt: inputMessages})
                }
            }

            const outputMessages = attrs["gen_ai.output.messages"]
            if (outputMessages !== undefined) {
                try {
                    const parsed =
                        typeof outputMessages === "string"
                            ? JSON.parse(outputMessages)
                            : outputMessages
                    // Mastra output messages: [{role, parts: [{type: "text", text: "..."}]}]
                    // Convert to Agenta format: {completion: [{role, content}]}
                    const completion = Array.isArray(parsed)
                        ? parsed.map((msg: Record<string, unknown>) => {
                              const parts = msg.parts as Record<string, unknown>[] | undefined
                              let content = ""
                              const toolCalls: unknown[] = []
                              if (Array.isArray(parts)) {
                                  for (const part of parts) {
                                      if (part.type === "text" && part.text)
                                          content += String(part.text)
                                      else if (part.type === "tool_call") toolCalls.push(part)
                                  }
                              } else if (typeof msg.content === "string") {
                                  content = msg.content
                              }
                              const result: Record<string, unknown> = {role: msg.role, content}
                              if (toolCalls.length > 0) result.toolCalls = toolCalls
                              return result
                          })
                        : [{role: "assistant", content: String(parsed)}]
                    m["ag.data.outputs"] = toJson({completion})
                } catch {
                    m["ag.data.outputs"] = toJson({
                        completion: [{role: "assistant", content: String(outputMessages)}],
                    })
                }
            }

            // Tool calls from response
            const responseToolCalls = attrs["gen_ai.response.tool_calls"]
            if (responseToolCalls !== undefined) {
                try {
                    const parsed =
                        typeof responseToolCalls === "string"
                            ? JSON.parse(responseToolCalls)
                            : responseToolCalls
                    const existing = m["ag.data.outputs"]
                    const obj =
                        typeof existing === "string" ? JSON.parse(existing) : (existing ?? {})
                    ;(obj as Record<string, unknown>).toolCalls = parsed
                    m["ag.data.outputs"] = toJson(obj)
                } catch {
                    /* skip */
                }
            }
        } else if (operation === "execute_tool" || spanName.startsWith("execute_tool ")) {
            // TOOL_CALL — tool execution
            m["ag.type.node"] = "tool"

            const toolName = attrs["gen_ai.tool.name"]
            const toolArgs = attrs["gen_ai.tool.call.arguments"]
            const toolResult = attrs["gen_ai.tool.call.result"]

            if (toolArgs !== undefined) {
                try {
                    m["ag.data.inputs"] = toJson(
                        typeof toolArgs === "string" ? JSON.parse(toolArgs) : toolArgs,
                    )
                } catch {
                    m["ag.data.inputs"] = toJson({args: toolArgs})
                }
            }
            if (toolResult !== undefined) {
                try {
                    m["ag.data.outputs"] = toJson(
                        typeof toolResult === "string" ? JSON.parse(toolResult) : toolResult,
                    )
                } catch {
                    m["ag.data.outputs"] = toJson({result: toolResult})
                }
            }
            // Preserve tool name for Agenta's trace viewer
            if (toolName) {
                m["ai.toolCall.name"] = String(toolName)
            } else {
                // Extract from span name: "execute_tool {name}"
                const nameFromSpan = spanName.startsWith("execute_tool ")
                    ? spanName.slice("execute_tool ".length)
                    : undefined
                if (nameFromSpan) m["ai.toolCall.name"] = nameFromSpan
            }
        } else if (operation === "invoke_agent" || spanName.startsWith("invoke_agent ")) {
            // AGENT_RUN — agent invocation
            m["ag.type.node"] = "agent"

            const agentId = attrs["gen_ai.agent.id"]
            const agentName = attrs["gen_ai.agent.name"]
            const systemInstructions = attrs["gen_ai.system_instructions"]

            if (agentId) m["ag.meta.agentId"] = String(agentId)
            if (agentName) m["ag.meta.agentName"] = String(agentName)
            if (systemInstructions) {
                m["ag.data.inputs"] = toJson({systemInstructions: String(systemInstructions)})
            }
        } else if (operation === "invoke_workflow" || spanName.startsWith("invoke_workflow ")) {
            // WORKFLOW_RUN — workflow invocation
            m["ag.type.node"] = "workflow"
        }

        // ── Session / conversation ──
        const conversationId = attrs["gen_ai.conversation.id"] ?? attrs["ag.session.id"]
        if (conversationId) m["ag.session.id"] = String(conversationId)

        // ── Mastra metadata → Agenta metadata ──
        for (const [key, value] of Object.entries(attrs)) {
            if (key.startsWith("mastra.metadata.")) {
                const metaKey = key.slice("mastra.metadata.".length)
                // Map known keys to Agenta conventions
                if (metaKey === "userId") m["ag.meta.userId"] = String(value)
                else if (metaKey === "sessionId") m["ag.session.id"] = String(value)
                else if (metaKey === "applicationId") m["ag.refs.application.id"] = String(value)
                else if (metaKey === "applicationRevisionId")
                    m["ag.refs.application_revision.id"] = String(value)
                else m[`ag.meta.${metaKey}`] = value
            }
        }

        return m
    },
}
