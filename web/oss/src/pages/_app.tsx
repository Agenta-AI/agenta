import "@agenta/ui/custom-resize-handle.css"
// Cascade order is load-bearing: globals must land before the vendor sheets below.

import "@/oss/styles/globals.css"
import "react-resizable/css/styles.css"
// Streamdown's own stylesheet. Its token-animation keyframes ([data-sd-animate]) are unused —
// that animator is gated on an `isAnimating` prop nothing here passes, and the chat types text
// through `useTypewriter` instead — but the sheet also carries the renderer's base styles.
import "streamdown/styles.css"
import {registerDriveCodeBlock, registerDriveMarkdown} from "@agenta/entity-ui/drive"
import dynamic from "next/dynamic"

import Markdown from "@/oss/components/AgentChatSlice/assets/markdown"
import AppPage from "@/oss/components/pages/_app"

// The drive's file preview renders markdown and code with this app's own renderers — the code
// one is Lexical + lazy-Shiki (~8.7 MB), which is exactly why the package takes it by injection.
const DriveCodeBlock = dynamic(() => import("@/oss/components/DynamicCodeBlock/CodeBlock"), {
    ssr: false,
})
registerDriveMarkdown(Markdown)
registerDriveCodeBlock(DriveCodeBlock)

export default AppPage
