import type {Meta, StoryObj} from "@storybook/nextjs"

import {demoTheme} from "../../website/src/components/workspace-demo/theme"
import WorkspaceDemo from "../../website/src/components/WorkspaceDemo"
import "../../website/src/styles/workspace-demo.css"
import "../../website/src/styles/playground-settings.css"

const meta = {
    title: "Marketing/Workspace demo",
    component: WorkspaceDemo,
    parameters: {layout: "fullscreen"},
    decorators: [
        (Story) => (
            <>
                <style>{demoTheme}</style>
                <div style={{fontFamily: "Inter, sans-serif", padding: 24}}>
                    <Story />
                </div>
            </>
        ),
    ],
} satisfies Meta<typeof WorkspaceDemo>
export default meta
export const Default: StoryObj<typeof meta> = {}
export const Dark: StoryObj<typeof meta> = {
    decorators: [
        (Story) => (
            <div data-theme="dark">
                <Story />
            </div>
        ),
    ],
}

export const AutomationHistory: StoryObj<typeof meta> = {
    args: {initialState: {view: "automations", automation: 0, historyOpen: true}},
}
export const FailedAutomationRun: StoryObj<typeof meta> = {
    args: {initialState: {view: "automations", automation: 2, historyOpen: true}},
}
export const EmptyAutomationHistory: StoryObj<typeof meta> = {
    args: {
        initialState: {view: "automations", automation: 0, historyOpen: true},
        emptyHistory: true,
    },
}

export const PlaygroundSettings: StoryObj<typeof meta> = {
    args: {initialState: {view: "playground", session: 0}},
}
export const SalesSettings: StoryObj<typeof meta> = {
    args: {initialState: {view: "playground", session: 7}},
}
