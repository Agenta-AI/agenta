import {useEffect, useRef} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"

import {BrowserPreviewView} from "../../../packages/agenta-entity-ui/src/browser/BrowserPreviewCard"

/** The card in the chat while the agent browses. Frames only come from a running browser. */
const Preview = ({title, url, tabCount}: {title: string; url: string; tabCount: number}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    useEffect(() => {
        const context = canvasRef.current?.getContext("2d")
        if (!context) return
        context.fillStyle = "#f6f6ef"
        context.fillRect(0, 0, 300, 150)
    }, [])
    return (
        <BrowserPreviewView
            title={title}
            url={url}
            tabCount={tabCount}
            live
            canvasRef={canvasRef}
            onOpen={() => {}}
        />
    )
}

const meta = {
    title: "@agenta/entity-ui/Browser/BrowserPreviewCard",
    component: Preview,
    parameters: {layout: "padded"},
    args: {title: "Hacker News", url: "https://news.ycombinator.com/", tabCount: 1},
} satisfies Meta<typeof Preview>

export default meta
type Story = StoryObj<typeof Preview>

export const OneTab: Story = {}

export const SeveralTabs: Story = {args: {tabCount: 3}}

export const LongTitle: Story = {
    args: {title: "GitHub - Agenta-AI/agenta: a workspace where you build agents", tabCount: 2},
}

export const NoTitleYet: Story = {args: {title: ""}}
