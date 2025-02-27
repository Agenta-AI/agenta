export type TokenContent = string | Token | (string | Token)[]

export interface Token {
    type: string
    content: TokenContent
}

export interface Tokenizer {
    defaultLanguage: string
    tokenize(code: string, language?: string): (string | Token)[]
}
