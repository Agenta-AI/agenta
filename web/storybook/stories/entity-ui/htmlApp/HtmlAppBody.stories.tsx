import {useMemo} from "react"

import {type AppAccess, type HtmlAppHostOptions} from "@agenta/entities/drive"
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
 * The HTML app body as `DriveHtmlApp` renders it: the app running in its folder. The mount io,
 * the host factory and the grant store come through `HtmlAppEnvContext`, so each story pins
 * exactly one state without touching the shared jotai store or sessionStorage.
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
    latencyMs,
    canEditMounts = true,
    preGrant,
}: {
    /** Slow io: the starting skeleton stays visible. */
    latencyMs?: number
    canEditMounts?: boolean
    /** Skip the sheet: the answer is already stored for this mount + dir. */
    preGrant?: AppAccess
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
        if (preGrant) grants.set(STORY_MOUNT.id, APP_DIR, {level: preGrant, writeRefused: false})
        return {
            io,
            canEditMounts,
            kitCss: KIT_CSS,
            grants,
            createHost: (opts: HtmlAppHostOptions) =>
                createStoryHost(BOARD_APP, {
                    grant: opts.grant,
                    requestAccess: opts.requestAccess,
                    dir: opts.dir,
                    tokens: opts.tokens,
                }),
        }
        // Fixtures are static per story.
    }, [])
    return (
        <HtmlAppEnvContext.Provider value={env}>
            <Frame>
                <HtmlAppBody
                    mount={STORY_MOUNT}
                    path={`${APP_DIR}/index.html`}
                    displayPath={`${APP_DIR}/index.html`}
                    content={BOARD_APP["index.html"]}
                    onNavigate={() => undefined}
                />
            </Frame>
        </HtmlAppEnvContext.Provider>
    )
}

/** First visit: no access; the board's first read asks "read files?", its first write "change files?". */
export const AsksOnFirstFileCall: Story = {
    render: () => <BodyStory />,
}

/** The grant is already stored: the app runs with it and never asks (what a second visit sees). */
export const Granted: Story = {
    render: () => <BodyStory preGrant="read-write" />,
}

/** "Don't allow" is stored: the app runs with no file access and is not asked again. */
export const Refused: Story = {
    render: () => <BodyStory preGrant="none" />,
}

/** A drive without edits: the app is asked about reading only; its writes fail `read_only`. */
export const ReadOnlyDrive: Story = {
    render: () => <BodyStory canEditMounts={false} />,
}

/** Slow mount io: the starting skeleton stays up while the manifest loads. */
export const Loading: Story = {
    render: () => <BodyStory preGrant="read-write" latencyMs={60_000} />,
}
