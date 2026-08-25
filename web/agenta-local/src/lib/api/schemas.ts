import {z} from "zod"

export const errorSchema = z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().default(false),
    next_step: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
})

export const modelSpecSchema = z.object({
    provider: z.string().min(1),
    name: z.string().min(1),
    parameters: z.record(z.string(), z.unknown()),
})

export const agentRevisionSchema = z.object({
    id: z.string(),
    version: z.number().int().positive(),
    instructions: z.string(),
    model: modelSpecSchema,
    execution: z.object({harness: z.literal("pi_core"), sandbox: z.literal("local")}),
})

export const agentSchema = z.object({
    id: z.string(),
    name: z.string(),
    current_revision: agentRevisionSchema,
    created_at: z.string(),
    updated_at: z.string(),
})

export const agentsSchema = z.array(agentSchema)

export const providerStateSchema = z.object({
    provider: z.string(),
    configured: z.boolean(),
    key_suffix: z.string(),
})

export const providerStatesSchema = z.array(providerStateSchema)

export const messageSchema = z.object({
    id: z.string(),
    session_id: z.string(),
    turn_id: z.string(),
    sequence: z.number().int(),
    role: z.enum(["user", "assistant", "system"]),
    content: z.record(z.string(), z.unknown()),
    created_at: z.string(),
})

export const sessionSchema = z.object({
    id: z.string(),
    agent_revision_id: z.string(),
    title: z.string().nullable(),
    status: z.enum(["active", "archived"]),
    created_at: z.string(),
    updated_at: z.string(),
})

export const sessionsSchema = z.array(sessionSchema)
export const sessionDetailSchema = sessionSchema.extend({messages: z.array(messageSchema)})

export const stopSchema = z.object({stopped: z.boolean()})
export const shutdownSchema = z.object({stopping: z.literal(true)})
export const runtimeSchema = z.object({
    // The runner health payload carries status:"ok"; the proxy's error path
    // emits ok:false. Normalize both to `ok` for the banner.
    runner: z
        .object({ok: z.boolean().optional(), status: z.string().optional()})
        .passthrough()
        .transform((runner) => ({...runner, ok: runner.ok ?? runner.status === "ok"})),
    version: z.string(),
})
export const healthSchema = z.object({
    ok: z.boolean(),
    version: z.string(),
    schema_version: z.union([z.string(), z.number()]),
    recovered_turns: z.number().int(),
})

const textDeltaSchema = z.object({type: z.literal("text-delta"), id: z.string(), delta: z.string()})
const finishSchema = z.object({
    type: z.literal("finish"),
    finishReason: z.string().optional(),
    messageMetadata: z.record(z.string(), z.unknown()).optional(),
})
const dataErrorSchema = z.object({
    type: z.literal("data-agent-error"),
    data: z.object({code: z.string(), errorText: z.string()}),
})
const errorFrameSchema = z.object({type: z.literal("error"), errorText: z.string()})
const deniedSchema = z.object({type: z.literal("tool-output-denied"), toolCallId: z.string()})
const knownFrameSchema = z.union([
    textDeltaSchema,
    finishSchema,
    dataErrorSchema,
    errorFrameSchema,
    deniedSchema,
])

export const streamFrameSchema = z
    .object({type: z.string()})
    .passthrough()
    .superRefine((value, context) => {
        if (
            ["text-delta", "finish", "data-agent-error", "error", "tool-output-denied"].includes(
                value.type,
            )
        ) {
            const result = knownFrameSchema.safeParse(value)
            if (!result.success) {
                context.addIssue({code: "custom", message: result.error.message})
            }
        }
    })

export type Agent = z.infer<typeof agentSchema>
export type AgentRevision = z.infer<typeof agentRevisionSchema>
export type ProviderState = z.infer<typeof providerStateSchema>
export type Session = z.infer<typeof sessionSchema>
export type SessionDetail = z.infer<typeof sessionDetailSchema>
export type Message = z.infer<typeof messageSchema>
export type StreamFrame = z.infer<typeof streamFrameSchema>
