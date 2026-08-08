# Mobile flows — LITE phase (raw UI, real navigation + data)

**Status:** PLANNED · **Date:** 2026-07-26 · **Branch:** `feat/agenta-mobile-wave-1`
**Scope:** make the mobile app WORK — root context resolution → sessions list → read-only
chat replay — with deliberately RAW markup. A parallel agent owns radix primitives/package
conversions: invest NOTHING in component polish. Plain divs/buttons/lists, existing Tailwind
tokens (`text-xs`, `text-muted-foreground`, `border-border`, …), the two installed shadcn
components (`button`, `skeleton`) at most. No new shadcn installs, no motion work, no designed
skeleton states (raw "Loading…" / "No sessions" / "Something went wrong" text is correct for
this phase). One component per file and thin page shells still apply.

## Constraints (bake into every task)

- **No OSS/EE app-source edits.** `web/oss/src/**` and `web/ee/src/**` are read-only reference.
  Package edits (`web/packages/**`) are allowed and expected.
- Mobile eslint bans `antd`, `@ant-design/*`, lexical, `@/oss/*`, `@agenta/oss|ee` — consume
  `@agenta/*` packages only.
- Routes must match the gate's URL map: `/m/` → resolution → `/m/w/{ws}/p/{proj}/sessions` →
  `/m/w/{ws}/p/{proj}/sessions/{id}`. Under `basePath: "/m"` the pages are
  `pages/index.tsx`, `pages/w/[workspace_id]/p/[project_id]/sessions/index.tsx`,
  `pages/w/[workspace_id]/p/[project_id]/sessions/[session_id].tsx` (next/link handles the
  `/m` prefix automatically).
- Commit messages: conventional, never mention Claude/Anthropic, no Co-Authored-By trailers.
- Live stack: the dev stack is RUNNING. `docker restart agenta-ee-dev-web-mobile-1` is allowed;
  **NEVER** run `compose up`/`down`/`--build` in-session. Anything needing an image rebuild or
  service recreate is an **operator step** (Arda) — write it down, don't run it.

## Grounded facts (verified 2026-07-26, don't re-derive)

1. **No packages mount for web-mobile.** Both dev composes
   (`hosting/docker-compose/{oss,ee}/docker-compose.dev.yml`) mount only
   `web/mobile/src` + `web/mobile/public` into `web-mobile`; the `web` service mounts
   `../../../web/packages:/app/packages` — web-mobile must gain the same line.
2. **`@agenta/chat` is entirely absent from the dev images.** Both dev Dockerfiles
   (`web/oss/docker/Dockerfile.dev`, `web/ee/docker/Dockerfile.dev`) COPY every package
   manifest and src EXCEPT `packages/agenta-chat` (it postdates them). `pnpm i` runs at image
   build, so **any mobile dependency change requires an operator image rebuild** — src mounts
   don't cover `package.json`/lockfile/node_modules.
3. **Transpile mechanism:** packages ship TS source (`main: ./src/index.ts`); consumers list
   them in `next.config` `transpilePackages` (see `web/oss/next.config.ts:90`). Mobile has none
   today.
4. **Auth verdict: desktop cookies ride along.** SuperTokens is cookie-auth;
   `buildClientOptions()` (`@agenta/sdk/config`) strips the empty `Authorization` header for
   the browser cookie case. Probes go through Traefik at `localhost/m` → API `localhost/api`
   is same-origin → cookies sent automatically. Fallback UX on 401: raw "open the desktop app
   and sign in" message; NO auth page this phase. Caveat: no supertokens-web-js on mobile ⇒ no
   token auto-refresh; an expired access token 401s until the user touches the desktop app.
5. **API base:** `_document.tsx` already loads `/m/__env.js` (`beforeInteractive`) which sets
   `window.__env.NEXT_PUBLIC_AGENTA_API_URL` (dev: `http://localhost/api`). Mirror OSS:
   `configureAgentaSdk({host})` once at module scope of the provider file.
6. **Jotai/query wiring** (mirrors `web/oss/src/state/Providers.tsx`): `@agenta/entities`
   atoms read `queryClientAtom` (jotai-tanstack-query) and `projectIdAtom` from
   `@agenta/shared/state` (a plain writable atom the APP must set).
   `loadSessionMessages` uses `getDefaultStore()` — the jotai `<Provider>` MUST be
   `store={getDefaultStore()}`.
7. **Sessions list:** `querySessions({projectId, search?, limit?, next?, newest?, includeEnded,
   includeArchived, references?})` from `@agenta/entities/session` → `SessionStream[] | null`.
   Cursor pair = last row's `id` (`next`) + `updated_at ?? created_at` (`newest`). Row fields:
   `id`, `name`, `flags` (`alive`/`running`/`attached`), `created_at`, `updated_at`,
   `deleted_at` (=ended), `archived_at`, `references[] {id,slug,version}` (agent label =
   `references[0]?.slug`). Hide `archived_at` rows client-side (WP0 planning input).
8. **Read-only replay path** (no transport, no workflowMolecule):
   `loadSessionMessages(sessionId, onRefreshed)` (`@agenta/chat/assets`) → `UIMessage[]` →
   `buildTurnViewModels(messages, {busy: false, executedFor:
   createExecutedToolIdentityCache()})` (`@agenta/chat/model`) → `TurnViewModel[]` with
   pre-folded `items`: `{kind:"part"|"tools"|"clientTool"}`. Tool rows: `partToolName(part)` +
   `rowSummary(part)`. Records are IndexedDB-persisted with guaranteed revalidation —
   `onRefreshed` re-delivers the fresh transcript.
9. **Live send is NOT nearly free** — `useAgentConversation` requires `entityId` and
   `buildAgentRequest` reads the hydrated `workflowMolecule`. **Out of scope**; no severable
   task. The chat screen ships a raw "read-only on mobile for now" notice.
10. **Workspace/project resolution:** Fern has a `ProjectsClient.getProjects()` (resource
    `projects`), no accessor in `@agenta/sdk/resources.ts` yet (sessions accessor at line 88 is
    the pattern). Rows: `{project_id, project_name, workspace_id, workspace_name,
    organization_id, is_demo, is_default_project}` — one call yields the whole
    workspace→project tree. Desktop persists last-used in localStorage
    `lastUsedProjectsByWorkspace` (`{[workspaceId]: projectId}`) — read it for continuity;
    write mobile's own `agenta:mobile:last-context`.
11. **Versions to pin (match oss/chat):** `ai 6.0.0-beta.150`, `@ai-sdk/react
    3.0.0-beta.153`, `jotai ^2.16.1`, `jotai-tanstack-query ^0.11.0`, `@tanstack/react-query
    ^5.90.21`, `zod ^4.3.6`. Workspace dep syntax: `"@agenta/chat":
    "workspace:../packages/agenta-chat"` (oss pattern).
12. **Dependency closure** for install/transpile: chat → entities + playground + shared;
    entities → sdk + api-client + shared + ui. Runtime for THIS phase never touches
    playground/ui/antd (chat `/model` + `/assets` import only entities/shared + type-only
    `ai`), but the workspace links and transpile list must carry the closure.
13. **`hosting/docker-compose/ee/docker-compose.dev.yml` is dirty with Arda's PROTECTED
    uncommitted `CLAUDE_*` lines** — stage that file with `git add -p` (or but-hunk staging)
    and verify `git diff --cached | grep -c CLAUDE_` is 0 before committing.

---

## T1 — Wire `@agenta/*` packages into `@agenta/mobile`

**Files:** `web/mobile/package.json`, `web/mobile/next.config.ts`, `web/turbo.json`,
`web/pnpm-lock.yaml` (regenerated).

- `package.json` dependencies, add:

  ```json
  "@agenta/chat": "workspace:../packages/agenta-chat",
  "@agenta/entities": "workspace:../packages/agenta-entities",
  "@agenta/sdk": "workspace:../packages/agenta-sdk",
  "@agenta/shared": "workspace:../packages/agenta-shared",
  "@ai-sdk/react": "3.0.0-beta.153",
  "@tanstack/react-query": "^5.90.21",
  "ai": "6.0.0-beta.150",
  "jotai": "^2.16.1",
  "jotai-tanstack-query": "^0.11.0",
  "zod": "^4.3.6"
  ```

- `next.config.ts`:

  ```ts
  transpilePackages: [
      "@agenta/sdk",
      "@agentaai/api-client",
      "@agenta/shared",
      "@agenta/ui",
      "@agenta/entities",
      "@agenta/playground",
      "@agenta/chat",
  ],
  ```

- `web/turbo.json`: `@agenta/mobile#build` gains
  `"dependsOn": ["@agenta/shared#build", "@agenta/entities#build", "@agenta/chat#build"]`;
  `@agenta/mobile#types:check` gains `"dependsOn": ["^types:check"]`.
- `cd web && pnpm install` (host; refreshes the lockfile).

**Verify:** `pnpm --filter @agenta/mobile types:check` and `lint` pass; a throwaway probe
import of `querySessions` + `loadSessionMessages` typechecks (delete it after);
`grep -r "antd" web/mobile/src` empty.
**Commit:** `feat(mobile): wire @agenta/* workspace packages into the mobile app`

## T2 — Container wiring (dev compose + Dockerfiles) + live-stack runbook

**Files:** `hosting/docker-compose/oss/docker-compose.dev.yml`,
`hosting/docker-compose/ee/docker-compose.dev.yml`, `web/oss/docker/Dockerfile.dev`,
`web/ee/docker/Dockerfile.dev`, `web/mobile/docker/Dockerfile.gh`.

- Both dev composes, `web-mobile.volumes`, add (first position, matching `web`):
  `- ../../../web/packages:/app/packages`. **EE file: filtered staging per fact 13.**
- Both dev Dockerfiles: with the other manifests
  `COPY packages/agenta-chat/package.json ./packages/agenta-chat/`; with the other sources
  `COPY --chown=agenta:agenta packages/agenta-chat/src ./packages/agenta-chat/src` +
  `COPY --chown=agenta:agenta packages/agenta-chat/tsconfig.json ./packages/agenta-chat/`.
- `web/mobile/docker/Dockerfile.gh`: mirror the oss gh image's manifest+source COPY block for
  the closure (shared, ui, entities, playground, chat, sdk, api-client full-dir for its
  `prepare` build) so `pnpm i` resolves the new workspace deps. CI workflow
  `17-check-mobile.yml` build-smokes this on mobile-path PRs — that run is the verify.
- **Operator runbook (document in the commit body / README open items, do NOT run):** the live
  `web-mobile` container has neither the new deps nor `@agenta/chat` (facts 1–2). Applying this
  task = rebuild dev web image + recreate `web-mobile` (Arda:
  `run.sh --ee --dev --with-mobile --build`). Interim bootstrap of the RUNNING container, if
  needed before the rebuild:

  ```bash
  docker exec agenta-ee-dev-web-mobile-1 ls /app/packages   # confirm what's baked
  docker cp web/packages/agenta-chat agenta-ee-dev-web-mobile-1:/app/packages/
  docker cp web/mobile/package.json  agenta-ee-dev-web-mobile-1:/app/mobile/package.json
  docker cp web/pnpm-lock.yaml       agenta-ee-dev-web-mobile-1:/app/pnpm-lock.yaml
  docker exec agenta-ee-dev-web-mobile-1 pnpm install
  docker restart agenta-ee-dev-web-mobile-1
  ```

**Verify:** `docker compose -f hosting/docker-compose/ee/docker-compose.dev.yml config` and the
oss twin both validate; `git diff --cached | grep -c CLAUDE_` → 0; after the container has the
packages (bootstrap or rebuild): `curl -s -o /dev/null -w "%{http_code}" http://localhost/m/`
→ 200.
**Commit:** `chore(mobile): mount and bake @agenta/* packages for the web-mobile containers`

## T3 — Runtime glue: env, SDK host, providers, route→projectId sync

**Files:** `web/mobile/src/lib/env.ts`, `web/mobile/src/lib/queryClient.ts`,
`web/mobile/src/features/app/AppProviders.tsx`, `web/mobile/src/features/app/ContextSync.tsx`,
`web/mobile/src/pages/_app.tsx` (edit).

- `lib/env.ts`: `getEnv(key)` = `window.__env?.[key] ?? process.env[key] ?? ""`;
  `getApiUrl()` = `getEnv("NEXT_PUBLIC_AGENTA_API_URL")` (dev `__env.js` is already mirrored
  into `web/mobile/public/`).
- `lib/queryClient.ts`: one `new QueryClient({defaultOptions: {queries: {retry: 1,
  refetchOnWindowFocus: false}}})` singleton.
- `AppProviders.tsx` (the ONE non-obvious wiring — mirror oss `GlobalStateProvider`):

  ```tsx
  import {configureAgentaSdk} from "@agenta/sdk/config"
  import {QueryClientProvider} from "@tanstack/react-query"
  import {Provider, getDefaultStore} from "jotai"
  import {useHydrateAtoms} from "jotai/react/utils"
  import {queryClientAtom} from "jotai-tanstack-query"

  // Module scope, like oss _app: __env.js is beforeInteractive, so window.__env is set.
  configureAgentaSdk({host: getApiUrl()})

  const HydrateAtoms = ({children}: PropsWithChildren) => {
      useHydrateAtoms([[queryClientAtom, queryClient]])
      return children
  }

  export const AppProviders = ({children}: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>
          {/* default store — loadSessionMessages writes through getDefaultStore() */}
          <Provider store={getDefaultStore()}>
              <HydrateAtoms>
                  <ContextSync />
                  {children}
              </HydrateAtoms>
          </Provider>
      </QueryClientProvider>
  )
  ```

- `ContextSync.tsx`: null-rendering; reads `useRouter().query.project_id`, and
  `useEffect`-sets `setProjectIdAtom` (`@agenta/shared/state`); when both `workspace_id` and
  `project_id` are present, persists `agenta:mobile:last-context`
  (`{workspaceId, projectId}`) to localStorage.
- `_app.tsx`: wrap `<Component/>` in `<AppProviders>`.

**Verify:** types:check + lint; browser `localhost/m` still renders the shell; no console
errors from provider wiring.
**Commit:** `feat(mobile): app providers, sdk host pinning, and route-scoped project state`

## T4 — Root context resolution (`/m/` → workspace → project → sessions)

**Files:** `web/packages/agenta-sdk/src/resources.ts` (add accessor),
`web/mobile/src/lib/context.ts`, `web/mobile/src/features/context/ContextResolver.tsx`,
`web/mobile/src/features/context/WorkspaceProjectList.tsx`,
`web/mobile/src/features/context/states/SignedOutNotice.tsx`,
`web/mobile/src/pages/index.tsx` (replace proof-of-life).

- SDK accessor (pattern = `getSessionsClient`, same file):

  ```ts
  import {ProjectsClient} from "@agentaai/api-client/resources/projects"
  let _projects: ProjectsClient | undefined
  export function getProjectsClient(): ProjectsClient {
      return (_projects ??= new ProjectsClient(buildClientOptions()))
  }
  ```

- `lib/context.ts`: `fetchProjects()` → `getProjectsClient().getProjects()`, zod-parsed with a
  minimal schema (`project_id`, `project_name`, `workspace_id`, `workspace_name` nullish,
  `is_demo` nullish); catch → `{kind: "unauthenticated"}` when the error's `statusCode` is
  401/403, else `{kind: "error"}`. Plus `readLastContext()`/`readDesktopLastUsed()` helpers
  (`agenta:mobile:last-context`, then desktop's `lastUsedProjectsByWorkspace`).
- `ContextResolver.tsx` flow: (1) stored mobile last-context → `router.replace` to its
  sessions URL; (2) else fetch projects: exactly one → auto-forward; several → group by
  `workspace_id` and render `WorkspaceProjectList` (raw nested tappable list: workspace name
  header, project buttons; tap → replace to `/w/{ws}/p/{proj}/sessions`); (3) unauthenticated →
  `SignedOutNotice` (raw text: "Sign in on the desktop app first, then reload this page.");
  (4) error/empty → raw retry button.
- `pages/index.tsx`: thin shell rendering `ContextResolver`.

**Verify:** types:check + lint; browser: signed-in desktop session at `localhost` →
`localhost/m/` forwards to a sessions URL (or shows the picker with real names); private
window → the signed-out notice, no crash.
**Commit:** `feat(mobile): workspace and project resolution at the mobile root`

## T5 — Sessions list

**Files:** `web/mobile/src/features/sessions/useSessionsInfinite.ts`,
`SessionListScreen.tsx`, `SessionRow.tsx`, `SessionSearchBar.tsx`,
`states/SessionListStates.tsx` (raw loading/empty/error/end-of-list, one tiny component each is
overkill this phase — a single file of small named exports is acceptable within the states/
convention), `web/mobile/src/pages/w/[workspace_id]/p/[project_id]/sessions/index.tsx`.

- Hook (the non-obvious cursor pairing):

  ```ts
  const PAGE_SIZE = 30
  export const useSessionsInfinite = (projectId: string, search: string) =>
      useInfiniteQuery({
          queryKey: ["mobile", "sessions", projectId, search],
          enabled: Boolean(projectId),
          initialPageParam: null as null | {next: string; newest: string},
          queryFn: ({pageParam, signal}) =>
              querySessions({
                  projectId,
                  search: search || undefined,
                  limit: PAGE_SIZE,
                  next: pageParam?.next,
                  newest: pageParam?.newest,
                  abortSignal: signal,
              }),
          getNextPageParam: (lastPage) => {
              if (!lastPage || lastPage.length < PAGE_SIZE) return undefined
              const last = lastPage[lastPage.length - 1]
              const newest = last.updated_at ?? last.created_at
              return last.id && newest ? {next: last.id, newest} : undefined
          },
          staleTime: 30_000,
      })
  ```

- Screen: search input (plain `<input>`, 300 ms debounce via `useEffect`+timeout), rows =
  pages flattened, **client-filtered to `!archived_at`**, raw "Load more" `<button>` when
  `hasNextPage` (no intersection observer this phase).
- `SessionRow.tsx` (raw `<Link>` block): title `name ?? "Untitled session"`; sub-line = agent
  label `references?.[0]?.slug ?? references?.[0]?.id ?? "—"` + raw relative time from
  `updated_at ?? created_at` (tiny local `timeAgo` helper, no dayjs import needed); plain text
  badges: `flags?.alive` → "live", `deleted_at` → "ended".
- Page shell reads `router.query` ids, renders screen; guards non-string params.

**Verify:** types:check + lint; browser `localhost/m/w/{ws}/p/{proj}/sessions` lists real
sessions newest-first, search narrows (server-side), "Load more" appends without dup/skip
(scroll two pages, compare ids), archived sessions absent.
**Commit:** `feat(mobile): sessions list with search and windowed paging`

## T6 — Read-only chat replay

**Files:** `web/mobile/src/features/chat/useSessionTranscript.ts`, `ChatScreen.tsx`,
`ChatHeader.tsx`, `TurnRow.tsx`, `states/ChatStates.tsx`,
`web/mobile/src/pages/w/[workspace_id]/p/[project_id]/sessions/[session_id].tsx`.

- Hook:

  ```ts
  export const useSessionTranscript = (sessionId: string) => {
      const [messages, setMessages] = useState<UIMessage[]>([])
      const [state, setState] = useState<"loading" | "ready" | "empty">("loading")
      useEffect(() => {
          let cancelled = false
          setState("loading")
          setMessages([])
          void loadSessionMessages(sessionId, (fresh) => {
              if (!cancelled) setMessages(fresh) // disk-restore revalidation re-delivery
          }).then((msgs) => {
              if (cancelled) return
              setMessages(msgs ?? [])
              setState(msgs && msgs.length > 0 ? "ready" : "empty")
          })
          return () => {
              cancelled = true
          }
      }, [sessionId])
      return {messages, state}
  }
  ```

  (`loadSessionMessages` resolves `null` on failure/no-history — "empty" doubles as the
  history-unavailable state, raw text covers both.)
- `ChatScreen.tsx` (mount keyed `key={sessionId}` from the page shell — WP3b gotcha #1 applies
  to the transcript hook's per-session state too):

  ```ts
  const executedFor = useMemo(() => createExecutedToolIdentityCache(), [sessionId])
  const turns = useMemo(
      () => buildTurnViewModels(messages, {busy: false, executedFor}),
      [messages, executedFor],
  )
  // render turns.filter((t) => !t.hidden)
  ```

- `TurnRow.tsx` raw rendering of `vm.items`: `kind === "part"` → `part.type === "text"` gives
  `<p className="whitespace-pre-wrap text-xs">` (raw text, NO markdown this phase),
  `"reasoning"` gives a muted italic paragraph, anything else skipped; `kind === "tools"` →
  one muted line per part: `` `${partToolName(p)} — ${p.state}` `` + `rowSummary(p)` when
  non-null; `clientTool` never occurs (predicate defaults false). User turns right-aligned via
  a plain flex row; `vm.status.showError` → raw red error line.
- `ChatHeader.tsx`: back `<Link>` to the sessions URL + session title via
  `fetchSessionStream({sessionId, projectId})` (already exported from
  `@agenta/entities/session`) with `"Session"` fallback; a one-line notice under it:
  "Read-only on mobile for now — continue this session on desktop." (Live send is out of
  scope: it requires `workflowMolecule` hydration for `buildAgentRequest` — grounded fact 9.)
- Page shell: guard params, `<ChatScreen key={sessionId} …/>`.

**Verify:** types:check + lint; `pnpm --filter @agenta/mobile test` (middleware suite still
green); browser: open a real session from the list → history renders (user/assistant turns,
tool lines, error turns don't crash); reload → paints from IndexedDB then revalidates; back
link returns to the list; a bogus session id shows the empty state.
**Commit:** `feat(mobile): read-only session transcript replay`

---

## Out of scope (explicitly)

Live send / HITL (needs workflowMolecule + WP3b skin), auth pages (WP2), the project drawer,
designed states/skeletons, motion, markdown rendering, liveness polling, virtualized lists,
infinite-scroll observers. The severable "nearly free live send" clause was investigated and
rejected — it is not nearly free (fact 9).
