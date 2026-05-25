import {z} from "zod"

// ─── Shared schemas ─────────────────────────────────────────────────────────

export const annotationSchema = z.object({
    score: z.number().optional(),
    label: z.string().optional(),
    comment: z.string().optional(),
})

export const toolRefSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
})

export const traceSchema = z.object({
    traceInput: z.string(),
    traceOutput: z.string(),
})

export type Annotation = z.infer<typeof annotationSchema>
export type ToolRef = z.infer<typeof toolRefSchema>
