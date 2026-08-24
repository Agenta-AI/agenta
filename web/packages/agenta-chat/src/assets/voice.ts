import {getEnv} from "@agenta/shared/api"

/**
 * Composer voice input — the mic that dictates into the editor and records voice messages. Off by
 * default: a voice message is sent as an audio attachment, which the agent service does not accept
 * yet. Enable with `NEXT_PUBLIC_AGENT_VOICE_INPUT=true` to preview the UI.
 */
export const isAgentVoiceInputEnabled = (): boolean =>
    (getEnv("NEXT_PUBLIC_AGENT_VOICE_INPUT") || "").toLowerCase() === "true"

/**
 * Voice input shows when the per-user experimental setting is on, or when the deployment forces it
 * on with the env flag (so dev stacks that set it keep the UI without touching their settings).
 */
export const isAgentVoiceInputAvailable = (settingEnabled: boolean): boolean =>
    settingEnabled || isAgentVoiceInputEnabled()
