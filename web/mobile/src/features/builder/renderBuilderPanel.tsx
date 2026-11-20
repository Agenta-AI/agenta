import dynamic from "next/dynamic"

import {ChatLoading} from "../chat/states/ChatStates"

import type {BuilderPanelProps} from "./BuilderPanel"

// Loads on first use, so the session page does not carry the builder chat.
const BuilderPanel = dynamic(() => import("./BuilderPanel").then((m) => m.BuilderPanel), {
    ssr: false,
    loading: ChatLoading,
})

/** The render function the panel's Builder slot holds. */
export const renderBuilderPanel = (props: BuilderPanelProps) => <BuilderPanel {...props} />
