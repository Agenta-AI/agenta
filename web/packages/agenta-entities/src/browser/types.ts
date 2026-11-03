import {z} from "zod"

export const browserLiveStatusSchema = z.object({running: z.boolean().default(false)})
