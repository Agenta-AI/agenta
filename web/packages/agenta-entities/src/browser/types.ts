import {z} from "zod"

const pageText = z
    .string()
    .nullish()
    .transform((value) => value ?? "")

export const browserLiveStatusSchema = z
    .object({
        running: z.boolean().default(false),
        wait_reason: pageText,
        url: pageText,
        title: pageText,
    })
    .transform(({wait_reason, ...page}) => ({...page, waitReason: wait_reason}))

export type BrowserLiveStatus = z.infer<typeof browserLiveStatusSchema>
