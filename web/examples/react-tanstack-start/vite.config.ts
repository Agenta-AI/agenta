/**
 * Vite config for the TanStack Start spike.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ TanStack Start is a Vite-based meta-framework (not Next).   │
 *   │ The `tanstackStart()` plugin wires the H3/Nitro server      │
 *   │ runtime that handles src/routes/api/* server route entries. │
 *   │                                                             │
 *   │ Plugin order matters per docs: tanstackStart() MUST come    │
 *   │ BEFORE the React plugin (route generation + server function │
 *   │ compilation fail otherwise).                                │
 *   └─────────────────────────────────────────────────────────────┘
 */

import {tanstackStart} from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import {defineConfig} from "vite"

export default defineConfig({
    plugins: [tanstackStart(), viteReact()],
})
