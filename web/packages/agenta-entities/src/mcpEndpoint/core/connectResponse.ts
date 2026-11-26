/**
 * The answer of a person's own OAuth sign-in start (`POST .../connect?owner_kind=user`), checked
 * at the boundary: the consent popup needs the redirect, the attempt and its lifetime.
 */
import {z} from "zod"

export const personalMcpConnectResponseSchema = z.object({
    redirect_url: z.string().nullish(),
    attempt_id: z.string().nullish(),
    expires_in: z.number().nullish(),
    scopes_offered: z.array(z.string()).nullish(),
})

export type MCPPersonalConnectResponse = z.infer<typeof personalMcpConnectResponseSchema>
