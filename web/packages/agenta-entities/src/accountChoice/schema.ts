/**
 * Account choices: which of a person's own accounts an agent uses for one "user" item.
 *
 * Wire shapes of `/account-choices` (accounts package contract, section 7.1).
 */
import {z} from "zod"

/** How a "user" item found its account: the person's choice, their default, or a sign-in. */
export const accountMatchSchema = z.enum(["choice", "default", "sign_in"])

export const accountChoiceSchema = z.object({
    id: z.string(),
    workflow_id: z.string(),
    item_key: z.string(),
    secret_id: z.string().nullish(),
    gateway_connection_id: z.string().nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
})

export const accountChoicesResponseSchema = z.object({
    count: z.number(),
    account_choices: z.array(accountChoiceSchema),
})

export const accountChoiceResponseSchema = z.object({
    count: z.number(),
    account_choice: accountChoiceSchema.nullish(),
})

/** The account a "user" item gets when the asker runs the agent. */
export const itemAccountSchema = z.object({
    item_key: z.string(),
    match: accountMatchSchema.nullish(),
    gateway_connection_id: z.string().nullish(),
    secret_id: z.string().nullish(),
    name: z.string().nullish(),
    is_ready: z.boolean(),
    candidates: z.number().nullish(),
})

export const itemAccountsResponseSchema = z.object({
    count: z.number(),
    item_accounts: z.array(itemAccountSchema),
})

export type AccountMatch = z.infer<typeof accountMatchSchema>
export type AccountChoice = z.infer<typeof accountChoiceSchema>
export type ItemAccount = z.infer<typeof itemAccountSchema>
