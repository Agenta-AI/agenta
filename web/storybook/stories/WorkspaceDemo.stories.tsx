import type {Meta, StoryObj} from "@storybook/nextjs"

import {demoTheme} from "../../website/src/components/workspace-demo/theme"
import WorkspaceDemo from "../../website/src/components/WorkspaceDemo"
import "../../website/src/styles/workspace-demo.css"

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
