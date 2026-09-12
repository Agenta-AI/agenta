import {z} from "zod"

/**
 * Fern still types the connections list as the old shared `Connection`
 * shape (`provider_key`/`integration_key`) — no `ChannelConnection` type was
 * ever generated for it. This is the real one: `channel`/`external_key`/
 * `slug`/`data`/`flags`, per `core.channels.dtos.ChannelConnection`.
 */
export const channelConnectionSchema = z
    .object({
        id: z.string().nullable().optional(),
        slug: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        channel: z.string(),
        external_key: z.string(),
        data: z.record(z.string(), z.unknown()).nullable().optional(),
        flags: z
            .object({
                is_active: z.boolean().optional(),
                is_verified: z.boolean().optional(),
            })
            .optional(),
        created_at: z.string().nullable().optional(),
    })
    .passthrough()

export type ChannelConnection = z.infer<typeof channelConnectionSchema>

export const channelConnectionsResponseSchema = z.object({
    count: z.number().int().nonnegative().default(0),
    connections: z.array(channelConnectionSchema).default([]),
})

export type ChannelConnectionsResponse = z.infer<typeof channelConnectionsResponseSchema>
