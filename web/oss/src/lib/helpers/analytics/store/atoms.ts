import type {InstanceTelemetry} from "@agenta/shared/analytics"
import {atom} from "jotai"
import {type PostHog, type PostHogConfig} from "posthog-js"

export type {PostHogConfig}
export const posthogAtom = atom<PostHog | null>(null)
/** The API's `GET /instance/telemetry` answer for the signed-in user. */
export const instanceTelemetryAtom = atom<InstanceTelemetry | null>(null)
