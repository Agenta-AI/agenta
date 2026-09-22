import {useMemo} from "react"

import {type HtmlAppHostOptions} from "@agenta/entities/drive"
import {
    HtmlAppBody,
    HtmlAppEnvContext,
    KIT_CSS,
    createGrantStore,
    type HtmlAppEnv,
} from "@agenta/entity-ui/drive"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {
    APP_DIR,
    BOARD_APP,
    STORY_MOUNT,
    createStoryHost,
    fixtureIo,
} from "../../../fixtures/htmlApp"

/**
 * The HTML viewer body as `HtmlBody` renders it: Preview | Source today, plus Run when the
 * `agent-apps` flag is on. The flag, the mount io, the host factory and the grant store come
 * through `HtmlAppEnvContext`, so each story pins exactly one state without touching the shared
 * jotai store or localStorage.
 */
const meta = {
    title: "@agenta/entity-ui/Drive/HtmlApp/HtmlAppBody",
    component: HtmlAppBody,
    parameters: {layout: "padded"},
    tags: ["!autodocs"],
} satisfies Meta<typeof HtmlAppBody>

export default meta
type Story = StoryObj<typeof meta>

const Frame = ({children}: {children: React.ReactNode}) => (
    <div className="flex h-[440px] w-[760px] flex-col overflow-hidden rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer">
        {children}
    </div>
)

/** One story = one env: the mock host is seeded with the board app; io serves its files. */
const BodyStory = ({
    enabled,
    mount = STORY_MOUNT,
    latencyMs,
    canEditMounts = true,
    preGrant,
    controlledView,
}: {
    /** The Files pane owns the tabs: the body follows this view and renders no tab row. */
    controlledView?: "preview" | "run"
    enabled: boolean
    mount?: typeof STORY_MOUNT | null
    /** Slow io: the assembling skeleton stays visible. */
    latencyMs?: number
    canEditMounts?: boolean
    /** Skip the sheet: the grant is already stored for this mount + dir. */
    preGrant?: "read" | "read-write"
}) => {
    const env = useMemo<HtmlAppEnv>(() => {
        const seed = createStoryHost(BOARD_APP)
        const baseIo = fixtureIo(seed, APP_DIR)
        const io = latencyMs
            ? {
                  fetchText: (p: string) =>
                      new Promise<string | null>((r) =>
                          setTimeout(() => void baseIo.fetchText(p).then(r), latencyMs),
                      ),
                  fetchDataUri: baseIo.fetchDataUri,
              }
            : baseIo
        const grants = createGrantStore()
        if (preGrant && mount) grants.set(mount.id, APP_DIR, preGrant)
        return {
            enabled,
            io,
            canEditMounts,
            kitCss: KIT_CSS,
            grants,
            createHost: (opts: HtmlAppHostOptions) =>
                createStoryHost(BOARD_APP, {grant: opts.grant, dir: opts.dir, tokens: opts.tokens}),
        }
        // Fixtures are static per story.
    }, [])
    return (
        <HtmlAppEnvContext.Provider value={env}>
            <Frame>
                <HtmlAppBody
                    mount={mount}
                    path={`${APP_DIR}/index.html`}
                    displayPath={`${APP_DIR}/index.html`}
                    content={BOARD_APP["index.html"]}
                    onNavigate={() => undefined}
                    controlledView={controlledView}
                />
            </Frame>
        </HtmlAppEnvContext.Provider>
    )
}

/** Acceptance: flag OFF — Preview | Source exactly as today; no Run, no sheet, no host. */
export const FlagOff: Story = {
    render: () => <BodyStory enabled={false} />,
}

/** Acceptance: flag ON — Run appears; picking it asks for the grant, then mounts RunView. */
export const FlagOn: Story = {
    render: () => <BodyStory enabled />,
}

/** Flag ON with the grant already stored — Run mounts straight away (what a second visit sees). */
export const FlagOnGranted: Story = {
    render: () => <BodyStory enabled preGrant="read-write" />,
}

/** The Files pane path: the toolbar above owns Source | Preview | Run, so the body shows no tabs
 * and goes straight to Run (through the grant sheet when nothing is stored). */
export const HostOwnedTabsRun: Story = {
    render: () => <BodyStory enabled preGrant="read-write" controlledView="run" />,
}

/** Acceptance: loading — slow mount io keeps the assembling skeleton up (Preview and Run). */
export const Loading: Story = {
    render: () => <BodyStory enabled latencyMs={60_000} />,
}

/** Acceptance: unavailable — no drive behind the file (a composer attachment): Run is not
 * offered, Preview and Source still work. */
export const Unavailable: Story = {
    render: () => <BodyStory enabled mount={null} />,
}
