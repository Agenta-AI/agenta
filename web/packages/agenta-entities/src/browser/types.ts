import {z} from "zod"

const pageText = z
    .string()
    .nullish()
    .transform((value) => value ?? "")

/** `waiting` is the agent's open ask for the person; empty when it is not waiting. */
export const browserLiveStatusSchema = z.object({
    running: z.boolean().default(false),
    waiting: pageText,
    url: pageText,
    title: pageText,
})

export type BrowserSessionStatus = z.infer<typeof browserLiveStatusSchema>
