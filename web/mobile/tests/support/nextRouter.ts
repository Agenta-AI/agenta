import {vi} from "vitest"

/**
 * A stand-in for the Next router on a mobile project route.
 *
 * `useRouter` throws outright when no router is mounted, and a component rendered under
 * `/w/<workspace>/p/<project>/...` may read one: `TurnRow` does, to build the run-failure
 * callout's recovery escape. A suite that renders one of those outside a Next app has to supply
 * the route it would be read on, so the one spelling of that route lives here.
 */
export const routerPush = vi.fn()

/** Mutable, so a case can take a field away and check what the component does without it. */
export const routerQuery: Record<string, string | undefined> = {
    workspace_id: "ws-1",
    project_id: "proj-1",
}

export const nextRouterModule = {
    useRouter: () => ({push: routerPush, query: routerQuery, basePath: "", asPath: "/"}),
}
