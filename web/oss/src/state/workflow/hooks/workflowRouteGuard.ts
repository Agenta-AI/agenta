import type {RouteLayer} from "@/oss/state/appState"

/** Workflow-page guards own app-scoped routes only. */
export const shouldRunWorkflowRouteGuard = (routeLayer: RouteLayer): boolean => routeLayer === "app"
