// @vitest-environment jsdom
// /m fills the trace drawer's add-to-queue slot at load, before any screen renders, so the antd
// default is never mounted.
import {beforeEach, describe, expect, it, vi} from "vitest"

const configure = vi.hoisted(() => vi.fn())

vi.mock("@agenta/observability-ui/traceDrawer", () => ({
    configureTraceDrawerReferences: configure,
    TraceDrawer: () => null,
}))
vi.mock("@agenta/observability/traceDrawer", async () => {
    const {atom} = await import("jotai")
    return {isDrawerOpenAtom: atom(false)}
})
vi.mock("next/dynamic", () => ({default: () => () => null}))
vi.mock("@/features/observability/states/TraceSpanPanelSkeleton", () => ({
    TraceSpanPanelSkeleton: () => null,
}))
vi.mock("@/features/observability/bindTraceDrawerSeams", () => ({bindTraceDrawerSeams: vi.fn()}))
vi.mock("@/features/education/FeatureGuideDialog", () => ({FeatureGuideDialog: () => null}))
vi.mock("@/features/education/WhatsNewDialog", () => ({WhatsNewDialog: () => null}))
vi.mock("@agenta/entity-ui/drive", () => ({MediaViewerHost: () => null}))
vi.mock("@agenta/ui/hooks", () => ({useMediaQuery: () => true}))
vi.mock("next/router", () => ({useRouter: () => ({})}))

describe("add to queue slot registration", () => {
    beforeEach(() => {
        configure.mockClear()
        vi.resetModules()
    })

    it("The shadcn picker is registered when the global drawers load", async () => {
        await import("@/features/app/GlobalDrawers")
        expect(configure).toHaveBeenCalledTimes(1)
        expect(configure.mock.calls[0][0]).toHaveProperty("AddToQueuePopover")
        expect(configure.mock.calls[0][0]).toHaveProperty("AddToTestsetButton")
        expect(configure.mock.calls[0][0]).toHaveProperty("AnnotateDrawerButton")
    })
})
