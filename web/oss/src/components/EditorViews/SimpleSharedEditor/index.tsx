import {useCallback, useEffect, useMemo, useState} from "react"

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
import {Button, MenuProps} from "antd"
import clsx from "clsx"
import {$getRoot} from "lexical"
import dynamic from "next/dynamic"

import {EditorProvider, useLexicalComposerContext} from "@/oss/components/Editor/Editor"
import {ON_CHANGE_LANGUAGE} from "@/oss/components/Editor/plugins/code"
import {$isCodeBlockNode} from "@/oss/components/Editor/plugins/code/nodes/CodeBlockNode"
import {TOGGLE_MARKDOWN_VIEW} from "@/oss/components/Editor/plugins/markdown/commands"
import EnhancedButton from "@/oss/components/EnhancedUIs/Button"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"

import {checkIsHTML, checkIsJSON, checkIsYAML, getDisplayedContent} from "../assets/helper"

import {Format, SimpleSharedEditorProps} from "./types"

const Dropdown = dynamic(() => import("antd").then((mod) => mod.Dropdown), {ssr: false})

const SimpleSharedEditorContent = ({
    headerClassName,
    headerName,
    isJSON,
    isYAML,
    isHTML,
    isMinimizeVisible = true,
    isFormatVisible = true,
    isCopyVisible = true,
    formatDropdownProps,
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

    const menuItems: MenuProps["items"] = useMemo(
        () => [
            {
                key: "text",
                icon: <TextAa size={14} />,
                label: "Text",
                onClick: toText,
                disabled: isJSON || isYAML || isHTML || disableFormatItems?.text,
            },
            {
                key: "markdown",
                icon: <MarkdownLogo size={14} />,
                label: "Markdown",
                onClick: toMarkdown,
                disabled: isJSON || isYAML || isHTML || disableFormatItems?.markdown,
            },
            {
                key: "json",
                icon: <BracketsCurly size={14} />,
                label: "JSON",
                onClick: toJson,
                disabled: (!isJSON && !isYAML) || isHTML || disableFormatItems?.json,
            },
            {
                key: "yaml",
                icon: <Code size={14} />,
                label: "YAML",
                onClick: toYaml,
                disabled: (!isYAML && !isJSON) || isHTML || disableFormatItems?.yaml,
            },
            ...(isHTML
                ? [
                      {
                          key: "html",
                          icon: <Code size={14} />,
                          label: "HTML",
                          disabled: (!isHTML && !isJSON && !isYAML) || disableFormatItems?.html,
                      },
                  ]
                : []),
        ],
        [isJSON, toText, toJson, toYaml, toMarkdown, disableFormatItems, isYAML, isHTML],
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
                            <Dropdown
                                {...formatDropdownProps}
                                placement="bottomRight"
                                trigger={["click"]}
                                overlayStyle={{width: 120}}
                                menu={{
                                    items: menuItems,
                                    selectable: true,
                                    selectedKeys: [language],
                                }}
                            >
                                <Button
                                    className={clsx([
                                        "capitalize flex items-center gap-1",
                                        {"!uppercase": isJSON || isYAML || isHTML},
                                    ])}
                                    size="small"
                                    type="text"
                                >
                                    {language} <CaretUpDown size={14} />
                                </Button>
                            </Dropdown>
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
