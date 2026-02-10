import {Role} from "./types"

export const COMPLETION_MESSAGES = ["Germany", "France"]

export const PROMPT_MESSAGES = [
    {prompt: "You are expert in geography", role: Role.SYSTEM},
    {prompt: "You should only answer with the capital of {{country}}", role: Role.USER},
]

export const NEW_VARIABLES = [{oldKey: "country", newKey: "city"}]
