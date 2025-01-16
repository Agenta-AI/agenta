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
