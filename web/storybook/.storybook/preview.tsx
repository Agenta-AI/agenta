import React from "react"

import type {Preview} from "@storybook/nextjs"

import {AgentaProviders, type StoryTheme} from "./decorators/AgentaProviders"

// Surfaces render errors in the DOM (the static build otherwise swallows them into a
// generic "No Preview"). Remove once the pipeline is stable.
class StoryErrorBoundary extends React.Component<{children: React.ReactNode}, {err: Error | null}> {
    state = {err: null as Error | null}
    static getDerivedStateFromError(err: Error) {
        return {err}
    }
    componentDidCatch(err: Error) {
        try {
            ;(window as unknown as {__STORY_ERR__?: string}).__STORY_ERR__ = String(
                err?.stack || err,
            )
        } catch {
            /* ignore */
        }
    }
    render() {
        if (this.state.err) {
            return (
                <pre style={{color: "#d61010", whiteSpace: "pre-wrap", fontSize: 12, padding: 16}}>
                    {String(this.state.err?.stack || this.state.err)}
                </pre>
            )
        }
        return this.props.children
    }
}
// Pulls the real theme-variables.css + tailwind layers (globals imports them and
// declares the `@layer tailwind-base, antd` ordering that lets antd win over
// Tailwind base — reproducing that ordering is what makes renders pixel-faithful).
import "./styles.css"

const preview: Preview = {
    parameters: {
        layout: "centered",
        controls: {expanded: true, matchers: {color: /(background|color)$/i, date: /Date$/i}},
        options: {
            storySort: {
                // Lead with the @agenta/ui inventory; put each folder's Overview page first.
                order: [
                    "@agenta/ui",
                    [
                        "Primitives",
                        ["Overview", "*"],
                        "Enhanced",
                        ["Overview", "*"],
                        "Presentational",
                        ["Overview", "*"],
                        "Domain",
                        ["Overview", "*"],
                    ],
                    "antd",
                    "*",
                ],
            },
        },
    },
    globalTypes: {
        theme: {
            description: "Agenta app theme",
            defaultValue: "light",
            toolbar: {
                title: "Theme",
                icon: "circlehollow",
                items: [
                    {value: "light", title: "Light", icon: "sun"},
                    {value: "dark", title: "Dark", icon: "moon"},
                ],
                dynamicTitle: true,
            },
        },
    },
    decorators: [
        // Real app provider stack (theme, antd App, jotai, query client) around every story.
        function AgentaDecorator(Story, ctx) {
            return (
                <StoryErrorBoundary>
                    <AgentaProviders theme={(ctx.globals.theme as StoryTheme) ?? "light"}>
                        <Story />
                    </AgentaProviders>
                </StoryErrorBoundary>
            )
        },
    ],
    // Every component meta gets an autodocs "Docs" page (prop table + description) unless it
    // opts out with tags: ["!autodocs"].
    tags: ["autodocs"],
}

export default preview
