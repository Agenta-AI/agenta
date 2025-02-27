/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * This file is adapted from Meta's Lexical project:
 * https://github.com/facebook/lexical
 */

export default function invariant(
    cond?: boolean,
    message?: string,
    ...args: string[]
): asserts cond {
    if (cond) {
        return
    }

    throw new Error(
        "Internal Lexical error: invariant() is meant to be replaced at compile " +
            "time. There is no runtime version. Error: " +
            message,
    )
}
