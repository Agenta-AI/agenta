import {useState} from "react"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {CopyButton} from "@agenta/ui"
import {CaretDown} from "@phosphor-icons/react"

import CodeBlock from "@/oss/components/DynamicCodeBlock/CodeBlock"
import {LanguageItem} from "@/oss/lib/Types"

interface DynamicCodeBlockProps {
    codeSnippets: Record<string, string>
}

const DynamicCodeBlock: React.FC<DynamicCodeBlockProps> = ({codeSnippets}) => {
    const supportedLanguages: LanguageItem[] = [
        {displayName: "Python", languageKey: "python"},
        {displayName: "cURL", languageKey: "bash"},
        {displayName: "TypeScript", languageKey: "typescript"},
    ]
    const [selectedLanguage, setSelectedLanguage] = useState(supportedLanguages[0])

    const handleLanguageSelect = (languageItem: LanguageItem) => {
        setSelectedLanguage(languageItem)
    }

    return (
        <div className="rounded-[10px] flex flex-col">
            <div className="flex items-center justify-end">
                <div className="text-[1em] mr-[10px]">
                    <span>Language:</span>
                </div>

                {selectedLanguage && (
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-background hover:bg-muted hover:text-foreground text-sm font-medium transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 h-7 gap-1 px-2.5"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {selectedLanguage.displayName}
                            <CaretDown size={12} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                            {supportedLanguages.map((languageItem, index) => (
                                <DropdownMenuItem
                                    key={index + 1}
                                    onClick={() => handleLanguageSelect(languageItem)}
                                >
                                    {languageItem.displayName}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
                <CopyButton
                    type="primary"
                    size="small"
                    text={codeSnippets[selectedLanguage.displayName]}
                    className="ml-[15px]"
                />
            </div>

            {selectedLanguage && (
                <CodeBlock
                    key={selectedLanguage.languageKey}
                    language={selectedLanguage.languageKey}
                    value={codeSnippets[selectedLanguage.displayName]}
                />
            )}
        </div>
    )
}

export default DynamicCodeBlock
