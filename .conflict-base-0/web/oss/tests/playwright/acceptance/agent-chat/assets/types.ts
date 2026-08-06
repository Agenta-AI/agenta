import {BaseFixture} from "@agenta/web-tests/tests/fixtures/base.fixture/types"

import type {ElicitationPayloadFixture} from "./elicitationStream"

/** A handle the mock returns so a spec can assert what the transport actually sent. */
export interface ElicitationInvokeMock {
    /** Every POST body seen on `**​/invoke*`, in order (index 0 = initial send, 1 = resume). */
    readonly calls: Array<Record<string, any>>
    /** How the second (resume) turn "replies" — override to echo the submitted values. */
    setResumeText: (text: string) => void
}

export interface AgentChatFixtures extends BaseFixture {
    /**
     * Seed a rendered agent (`is_agent`) app+revision and return its appId. The playground only
     * mounts `AgentChatPanel` for an agent workflow, so a completion/chat app will NOT exercise the
     * elicitation widget. See tests.ts for the first-run resolution note — this is the one seam that
     * needs the live stack to pin down.
     */
    seedAgentChatApp: () => Promise<string>
    /** Navigate to the agent playground for `appId` and wait until the chat panel is interactive. */
    navigateToAgentPlayground: (appId: string) => Promise<void>
    /**
     * Intercept `**​/invoke*`: the first run streams the paused elicitation form; the second (the
     * auto-resume after settle) streams a normal text turn. Returns the mock handle.
     */
    mockElicitationInvoke: (payload?: ElicitationPayloadFixture) => Promise<ElicitationInvokeMock>
    /** Type a message into the agent chat composer and send it. */
    sendChatMessage: (text: string) => Promise<void>
}
