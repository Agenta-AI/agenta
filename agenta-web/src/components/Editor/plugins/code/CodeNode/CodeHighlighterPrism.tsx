/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * From: https://github.com/facebook/lexical
 * MIT License - see LICENSE file in the root directory
 */

import "prismjs"

import "prismjs/components/prism-javascript"
import "prismjs/components/prism-typescript"
import "prismjs/components/prism-json"
import "prismjs/components/prism-yaml"

declare global {
    interface Window {
        Prism: typeof import("prismjs")
    }
}

export const Prism: typeof import("prismjs") =
    (globalThis as {Prism?: typeof import("prismjs")}).Prism || window.Prism
