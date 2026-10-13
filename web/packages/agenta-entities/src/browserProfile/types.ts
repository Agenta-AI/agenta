import {z} from "zod"

export const browserProfileSchema = z.object({
    id: z.string(),
    name: z.string(),
    allowed_hosts: z.array(z.string()),
    state: z.enum(["pending_login", "ready"]),
    generation: z.number(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
    created_by_id: z.string().nullish(),
})

export type BrowserProfile = z.infer<typeof browserProfileSchema>

export const browserProfileResponseSchema = z.object({
    count: z.number(),
    profile: browserProfileSchema,
})

export const browserProfilesResponseSchema = z.object({
    count: z.number(),
    profiles: z.array(browserProfileSchema),
})

export const browserLiveStatusSchema = z.object({running: z.boolean()})

export interface BrowserProfileInput {
    name: string
    allowed_hosts: string[]
}

export type BrowserLiveTarget =
    | {kind: "login"; profileId: string}
    | {kind: "session"; sessionId: string}

export type BrowserLiveServerMessage =
    | {type: "frame"; data: string; width: number; height: number}
    | {type: "status"; control: "agent" | "user"; url: string; title: string}
    | {type: "notice"; message: string}

export type BrowserLiveClientMessage =
    | {
          type: "mouse"
          event: "down" | "up" | "move" | "wheel"
          x: number
          y: number
          button?: "left" | "middle" | "right"
          deltaX?: number
          deltaY?: number
      }
    | {type: "key"; event: "down" | "up"; key: string; code?: string}
    | {type: "text"; text: string}
    | {type: "control"; take: boolean}
    | {type: "navigate"; url: string}
    | {type: "reload"}
