"use client"

import {NextStep} from "@agentaai/nextstepjs"

/**
 * Split point for the heavy NextStep tour renderer (~136 kB: NextStepReact +
 * motion/spotlight). Re-exporting it from a local module lets `next/dynamic`
 * code-split it into an async chunk via a relative path — a bare-specifier
 * `import("@agentaai/nextstepjs")` fails to resolve because the package's
 * exports map only declares an `import` condition for `.`.
 */
export default NextStep
