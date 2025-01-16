/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
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
