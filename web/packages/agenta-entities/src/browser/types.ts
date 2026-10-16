import {z} from "zod"

export const browserLiveStatusSchema = z.object({running: z.boolean().default(false)})

export type BrowserLiveServerMessage =
    | {type: "frame"; data: string; width: number; height: number}
    | {type: "status"; control: "agent" | "user"; url: string; title: string; waiting: string}
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
