import {createElement, type ComponentType} from "react"

import {ExtensionComponent} from "@lexical/react/ExtensionComponent"
import {ReactExtension} from "@lexical/react/ReactExtension"
import {useExtensionDependency} from "@lexical/react/useExtensionComponent"
import {configExtension, defineExtension} from "lexical"

import {AutoCloseTokenBracesPlugin} from "../AutoCloseTokenBracesPlugin"
import {TokenPlugin} from "../TokenPlugin"
import {TokenMenuPlugin} from "../TokenTypeaheadPlugin"

type TemplateFormat = "curly" | "fstring" | "jinja2"

interface TokenBehaviorConfig {
    templateFormat: TemplateFormat
    tokens: string[]
}

export const TokenBehaviorCoreExtension = defineExtension({
    name: "@agenta/editor/token/TokenBehaviorCore",
    config: {
        templateFormat: "curly",
        tokens: [],
    } as TokenBehaviorConfig,
    build: (_editor, config) => config,
})

function TokenBehaviorOverlay() {
    const {output: config} = useExtensionDependency(TokenBehaviorCoreExtension)

    return (
        <>
            <TokenPlugin templateFormat={config.templateFormat} />
            <AutoCloseTokenBracesPlugin />
            <TokenMenuPlugin tokens={config.tokens} />
        </>
    )
}

export const TokenBehaviorReactExtension = defineExtension({
    name: "@agenta/editor/token/TokenBehaviorReact",
    dependencies: [TokenBehaviorCoreExtension],
    build: () => ({Component: TokenBehaviorOverlay}),
})

function TokenBehaviorDecorator() {
    const ExtensionComponentWithNamespace = ExtensionComponent as unknown as ComponentType<{
        "lexical:extension": typeof TokenBehaviorReactExtension
    }>

    return createElement(ExtensionComponentWithNamespace, {
        "lexical:extension": TokenBehaviorReactExtension,
    })
}

export const TokenBehaviorExtension = defineExtension({
    name: "@agenta/editor/token/TokenBehavior",
    dependencies: [
        TokenBehaviorReactExtension,
        configExtension(ReactExtension, {
            decorators: [TokenBehaviorDecorator],
        }),
    ],
})
