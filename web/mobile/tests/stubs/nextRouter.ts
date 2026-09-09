/**
 * An inert Next router for unit tests.
 *
 * A unit test mounts no Next app, so `useRouter` throws "NextRouter was not mounted" as soon as a
 * rendered tree reaches for it. Two copies of Next resolve in this workspace — the app is on 16 and
 * the shared packages are on 15 — so a `vi.mock("next/router")` in one test file covers only the
 * copy that file resolves. The alias in `vitest.config.ts` points every copy here instead.
 *
 * Everything a caller reads is empty or root: no workspace id in the query, no basePath, `/` as the
 * path. Callers that build a link from those get null, which is what a test wants.
 */
export const useRouter = () => ({
    query: {} as Record<string, string | string[] | undefined>,
    basePath: "",
    asPath: "/",
    pathname: "/",
    route: "/",
    isReady: true,
    push: async () => true,
    replace: async () => true,
    prefetch: async () => undefined,
    back: () => undefined,
    forward: () => undefined,
    reload: () => undefined,
    events: {on: () => undefined, off: () => undefined, emit: () => undefined},
})

export const withRouter = <T>(component: T): T => component

export default {useRouter, withRouter}
