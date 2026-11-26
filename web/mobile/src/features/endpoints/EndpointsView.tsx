import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import type {AppEndpointSnippets} from "@agenta/settings-ui"
import {LoadError} from "@agenta/ui/components/presentational"
import {Alert} from "@agenta/ui/ui"

import {EndpointAppPicker, type EndpointApp} from "./EndpointAppPicker"
import {EndpointEnvironmentPicker} from "./EndpointEnvironmentPicker"
import {EndpointSnippets} from "./EndpointSnippets"
import {EndpointsNoVariants} from "./states/EndpointsNoVariants"
import {EndpointsPickApp} from "./states/EndpointsPickApp"
import {EndpointsSkeleton} from "./states/EndpointsSkeleton"

export type EndpointsViewState = "loading" | "error" | "pickApp" | "noVariants" | "ready"

export interface EndpointsViewProps {
    state: EndpointsViewState
    apps: readonly EndpointApp[]
    appId: string | null
    /** Absent inside the app menu, where the app comes from the path. */
    onPickApp?: (appId: string) => void
    onRetry: () => void
    environments: readonly AppEnvironmentDeployment[]
    selected: AppEnvironmentDeployment | null
    onSelectEnvironment: (slug: string) => void
    invoke: AppEndpointSnippets
    fetchConfig: AppEndpointSnippets
}

const Body = (props: EndpointsViewProps) => {
    switch (props.state) {
        case "loading":
            return <EndpointsSkeleton />
        case "error":
            return <LoadError framed title="Could not load endpoints" onRetry={props.onRetry} />
        case "pickApp":
            return <EndpointsPickApp />
        case "noVariants":
            return <EndpointsNoVariants />
        case "ready":
            return (
                <div className="flex min-w-0 flex-col gap-5">
                    <EndpointEnvironmentPicker
                        environments={props.environments}
                        selected={props.selected?.slug ?? null}
                        onSelect={props.onSelectEnvironment}
                    />
                    {props.selected?.deployedVariantId ? (
                        <EndpointSnippets invoke={props.invoke} fetchConfig={props.fetchConfig} />
                    ) : (
                        <Alert
                            type="warning"
                            showIcon
                            message="Publish Required"
                            description={`No variants have been published to ${
                                props.selected?.name ?? ""
                            } environment. Please publish a variant from the playground to proceed`}
                        />
                    )}
                </div>
            )
    }
}

/** What the Endpoints page shows under its title, for every state it can be in. */
export const EndpointsView = (props: EndpointsViewProps) => (
    <div className="flex min-w-0 flex-col gap-5" data-testid="endpoints-view">
        <p className="m-0 text-[13px] text-muted-foreground">
            Select an environment then use this endpoint to send requests to the LLM app.
        </p>
        {props.state === "loading" || !props.onPickApp ? null : (
            <EndpointAppPicker apps={props.apps} value={props.appId} onChange={props.onPickApp} />
        )}
        <Body {...props} />
    </div>
)
