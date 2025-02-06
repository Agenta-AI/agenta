/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * This file is adapted from Meta's Lexical project:
 * https://github.com/facebook/lexical
 */

import {Prism} from "../../CodeHighlighterPrism"
import {DEFAULT_CODE_LANGUAGE} from "../../CodeHighlightNode"
import {Token, Tokenizer} from "./types"

export const PrismTokenizer: Tokenizer = {
    defaultLanguage: DEFAULT_CODE_LANGUAGE,
    tokenize(code: string, language?: string): (string | Token)[] {
        return Prism.tokenize(
            code,
            Prism.languages[language || ""] || Prism.languages[this.defaultLanguage],
        )
    },
}
