import {createReferenceLabels} from "@agenta/observability-ui/traceDrawer"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

const routes = createReferenceLabels({
    app: (base, {appId}) => `${base}/apps/${encodeURIComponent(appId)}/overview`,
    variant: (base, {appId, revisionId}) =>
        `${base}/variants?app=${encodeURIComponent(appId)}&revisionId=${encodeURIComponent(revisionId)}`,
    environment: (base, {appId}) =>
        `${base}/variants?app=${encodeURIComponent(appId)}&tab=deployments`,
    testset: (base, {testsetId, revisionId}) =>
        `${base}/testsets/${encodeURIComponent(revisionId ?? testsetId)}`,
})

export type TraceReferenceKind = keyof typeof routes

/**
 * One trace drawer reference slot on /m. Developer mode shows the named, linked chips of the old
 * app; otherwise the plain label stays, as before.
 */
export const TraceReferenceLabel = ({
    kind,
    ...props
}: {kind: TraceReferenceKind} & Record<string, unknown>) => {
    const developerMode = useAtomValue(betaDeveloperModeActiveAtom)
    if (!developerMode) {
        const label = typeof props.label === "string" ? props.label : null
        return <span className="text-colorText">{label ?? "—"}</span>
    }
    const Label = routes[kind]
    return <Label {...props} />
}

export default TraceReferenceLabel
