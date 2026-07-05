import {useCallback, useEffect, useMemo, useState} from "react"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {
    EditorProvider,
    useLexicalComposerContext,
    ON_CHANGE_LANGUAGE,
    $isCodeBlockNode,
    TOGGLE_MARKDOWN_VIEW,
} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {mergeRegister} from "@lexical/utils"
import {
    BracketsCurly,
    CaretDown,
    CaretUp,
    CaretUpDown,
    Check,
    Code,
    Copy,
    MarkdownLogo,
    TextAa,
} from "@phosphor-icons/react"
import clsx from "clsx"
import {$getRoot} from "lexical"

import EnhancedButton from "@/oss/components/EnhancedUIs/Button"

import {checkIsHTML, checkIsJSON, checkIsYAML, getDisplayedContent} from "../assets/helper"

import {Format, SimpleSharedEditorProps} from "./types"

const SimpleSharedEditorContent = ({
    headerClassName,
    headerName,
    isJSON,
    isYAML,
    isHTML,
    isMinimizeVisible = true,
    isFormatVisible = true,
    isCopyVisible = true,
    copyButtonProps,
    minimizeButtonProps,
    disableFormatItems,
    showTextToMdOutside = false,
    minimizedHeight = 68,
    defaultMinimized = false,
    ...props
}: SimpleSharedEditorProps) => {
    const [minimized, setMinimized] = useState(() => Boolean(defaultMinimized))
    const [isCopied, setIsCopied] = useState(false)
    const [language, setLanguage] = useState<Format>(() =>
        isJSON ? "json" : isYAML ? "yaml" : "text",
    )

    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        const unregister = mergeRegister(
            editor.registerUpdateListener(({editorState}) => {
                editorState.read(() => {
                    const codeBlock = $getRoot().getChildren().find($isCodeBlockNode)
                    if (codeBlock) {
                        const _language = codeBlock.getLanguage()
                        setLanguage((cur) => (cur === _language ? cur : _language))
                    }
                })
            }),
        )
        return unregister
    }, [editor])

    // keep dropdown in sync with actual view
    useEffect(() => {
        if (isJSON) {
            setLanguage("json")
            editor.dispatchCommand(ON_CHANGE_LANGUAGE, {language: "json"})
        } else if (isYAML) {
            setLanguage("yaml")
            editor.dispatchCommand(ON_CHANGE_LANGUAGE, {language: "yaml"})
        } else if (isHTML) {
            setLanguage("html")
            editor.dispatchCommand(ON_CHANGE_LANGUAGE, {language: "html"})
        } else {
            setLanguage("markdown")
        }
    }, [isJSON, isYAML, isHTML, editor])

    const toText = useCallback(() => {
        if (language === "text") return
        editor.dispatchCommand(TOGGLE_MARKDOWN_VIEW, undefined)
        setLanguage("text")
    }, [editor, language])

    const toMarkdown = useCallback(() => {
        if (language === "markdown") return
        editor.dispatchCommand(TOGGLE_MARKDOWN_VIEW, undefined)
        setLanguage("markdown")
    }, [editor, language])

    const toJson = useCallback(() => {
        if (language === "json") return
        editor.dispatchCommand(ON_CHANGE_LANGUAGE, {language: "json"})
        setLanguage("json")
    }, [editor, language])

    const toYaml = useCallback(() => {
        if (language === "yaml") return
        editor.dispatchCommand(ON_CHANGE_LANGUAGE, {language: "yaml"})
        setLanguage("yaml")
    }, [editor, language])

    const onCopyText = useCallback(async () => {
        const text = props.value || props.initialValue
        let formattedText
        try {
            formattedText = getDisplayedContent(editor, language)
        } catch (e) {
            formattedText = text
            console.log(e)
        }

        if (text) {
            setIsCopied(true)

            await navigator.clipboard.writeText(formattedText)

            setTimeout(() => {
                setIsCopied(false)
            }, 1000)
        }
    }, [props.value, props.initialValue, language, editor])

    const languageOptions = useMemo(
        () => [
            {
                value: "text" as const,
                label: "Text",
                icon: <TextAa size={14} />,
                disabled: isJSON || isYAML || isHTML || !!disableFormatItems?.text,
            },
            {
                value: "markdown" as const,
                label: "Markdown",
                icon: <MarkdownLogo size={14} />,
                disabled: isJSON || isYAML || isHTML || !!disableFormatItems?.markdown,
            },
            {
                value: "json" as const,
                label: "JSON",
                icon: <BracketsCurly size={14} />,
                disabled: (!isJSON && !isYAML) || isHTML || !!disableFormatItems?.json,
            },
            {
                value: "yaml" as const,
                label: "YAML",
                icon: <Code size={14} />,
                disabled: (!isYAML && !isJSON) || isHTML || !!disableFormatItems?.yaml,
            },
            ...(isHTML
                ? [
                      {
                          value: "html" as const,
                          label: "HTML",
                          icon: <Code size={14} />,
                          disabled: (!isHTML && !isJSON && !isYAML) || !!disableFormatItems?.html,
                      },
                  ]
                : []),
        ],
        [isJSON, isYAML, isHTML, disableFormatItems],
    )

    return (
        <SharedEditor
            {...props}
            editorProps={{
                ...props.editorProps,
                codeOnly: isJSON || isYAML || isHTML || props.editorProps?.codeOnly,
                ...(isJSON || isYAML || isHTML ? {language: language as "json" | "yaml"} : {}),
                noProvider: true,
                showToolbar: false,
                enableTokens: false,
            }}
            style={{["--min-h" as any]: `${minimizedHeight}px`}}
            className={clsx(
                "transition-all duration-300 ease-in-out",
                minimized
                    ? "[&_.agenta-editor-wrapper]:h-[var(--min-h)] [&_.agenta-editor-wrapper]:overflow-y-auto [&_.agenta-editor-wrapper]:!mb-0"
                    : "[&_.agenta-editor-wrapper]:h-fit",
                props.className,
            )}
            header={
                <div
                    className={clsx([
                        "w-full flex items-center justify-between",
                        {"mt-2": isJSON || isYAML || isHTML},
                        headerClassName,
                    ])}
                >
                    <span className="font-medium">{headerName}</span>
                    <div className="flex items-center gap-2">
                        {isFormatVisible && (
                            <DropdownMenu>
                                <DropdownMenuTrigger
                                    className="inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-sm font-medium transition-all outline-none select-none hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 h-7 gap-1 px-2"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <span
                                        className={clsx("capitalize flex items-center gap-1", {
                                            "!uppercase": isJSON || isYAML || isHTML,
                                        })}
                                    >
                                        {language} <CaretUpDown size={14} />
                                    </span>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" style={{width: 120}}>
                                    <DropdownMenuRadioGroup
                                        value={language}
                                        onValueChange={(value) => {
                                            switch (value) {
                                                case "text":
                                                    toText()
                                                    break
                                                case "markdown":
                                                    toMarkdown()
                                                    break
                                                case "json":
                                                    toJson()
                                                    break
                                                case "yaml":
                                                    toYaml()
                                                    break
                                            }
                                        }}
                                    >
                                        {languageOptions.map((option) => (
                                            <DropdownMenuRadioItem
                                                key={option.value}
                                                value={option.value}
                                                disabled={option.disabled}
                                                closeOnClick
                                            >
                                                {option.icon}
                                                {option.label}
                                            </DropdownMenuRadioItem>
                                        ))}
                                    </DropdownMenuRadioGroup>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}

                        {showTextToMdOutside && (
                            <EnhancedButton
                                {...copyButtonProps}
                                icon={
                                    language === "text" ? (
                                        <MarkdownLogo size={14} />
                                    ) : (
                                        <TextAa size={14} />
                                    )
                                }
                                type="text"
                                size="small"
                                onClick={() => (language === "text" ? toMarkdown() : toText())}
                                tooltipProps={{
                                    title:
                                        language === "text" ? "Preview markdown" : "Preview text",
                                }}
                            />
                        )}

                        {isCopyVisible && (
                            <EnhancedButton
                                {...copyButtonProps}
                                icon={isCopied ? <Check size={14} /> : <Copy size={14} />}
                                type="text"
                                size="small"
                                onClick={onCopyText}
                                tooltipProps={{title: isCopied ? "Copied" : "Copy"}}
                            />
                        )}

                        {isMinimizeVisible && (
                            <EnhancedButton
                                {...minimizeButtonProps}
                                icon={minimized ? <CaretDown size={14} /> : <CaretUp size={14} />}
                                type="text"
                                size="small"
                                onClick={() => setMinimized((c) => !c)}
                                tooltipProps={{title: minimized ? "Maximize" : "Minimize"}}
                            />
                        )}
                    </div>
                </div>
            }
        />
    )
}

const SimpleSharedEditor = (props: SimpleSharedEditorProps) => {
    const isJSON = useMemo(() => {
        const value = props.initialValue || props.value
        if (!value) return false
        return checkIsJSON(typeof value === "string" ? value : JSON.stringify(value))
    }, [props.value, props.initialValue])

    const isYAML = useMemo(() => {
        const value = props.initialValue || props.value
        if (!value) return false
        return checkIsYAML(typeof value === "string" ? value : JSON.stringify(value))
    }, [props.value, props.initialValue])

    const isHTML = useMemo(() => {
        const value = props.initialValue || props.value
        if (!value) return false
        return checkIsHTML(typeof value === "string" ? value : JSON.stringify(value))
    }, [props.value, props.initialValue])

    return (
        <EditorProvider
            codeOnly={props.editorProps?.codeOnly || isJSON || isYAML || isHTML}
            enableTokens={false}
            showToolbar={false}
            disabled={props.disabled}
        >
            <SimpleSharedEditorContent
                {...props}
                isJSON={props.isJSON || isJSON}
                isYAML={props.isYAML || isYAML}
                isHTML={props.isHTML || isHTML}
            />
        </EditorProvider>
    )
}
export default SimpleSharedEditor
