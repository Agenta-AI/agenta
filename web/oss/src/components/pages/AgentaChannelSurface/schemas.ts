import {z} from "zod"

/**
 * Local schemas for the three routes the generated Fern client predates
 * (connection create/query, the Agenta read route) — see this package's
 * report for the regeneration gap. Loose/passthrough on purpose: this probe
 * only reads the fields it uses.
 */

export const agentaConnectionSchema = z
    .object({
        id: z.string(),
        slug: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        channel: z.string(),
        data: z.record(z.string(), z.unknown()).nullable().optional(),
        flags: z
            .object({
                is_active: z.boolean().optional(),
                is_verified: z.boolean().optional(),
            })
            .optional(),
    })
    .passthrough()

export type AgentaConnection = z.infer<typeof agentaConnectionSchema>

export const agentaConnectionsResponseSchema = z.object({
    count: z.number().int().nonnegative().default(0),
    connections: z.array(agentaConnectionSchema).default([]),
})

export const agentaConversationItemSchema = z
    .object({
        id: z.string(),
        direction: z.enum(["inbound", "outbound"]),
        created_at: z.string().nullable().optional(),
        content: z.array(z.record(z.string(), z.unknown())).default([]),
    })
    .passthrough()

export type AgentaConversationItem = z.infer<typeof agentaConversationItemSchema>

export const agentaConversationResponseSchema = z.object({
    count: z.number().int().nonnegative().default(0),
    items: z.array(agentaConversationItemSchema).default([]),
})

export type AgentaConversationResponse = z.infer<typeof agentaConversationResponseSchema>
