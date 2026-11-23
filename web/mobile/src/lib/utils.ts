import {clsx, type ClassValue} from "clsx"
import {extendTailwindMerge} from "tailwind-merge"

// Design-system text styles are font sizes; unregistered, tailwind-merge drops them as colours.
const twMerge = extendTailwindMerge({
    extend: {
        classGroups: {
            "font-size": [
                {
                    text: [
                        "display",
                        "heading",
                        "title",
                        "body",
                        "label",
                        "touch",
                        "meta",
                        "caption",
                        "code",
                        "code-sm",
                    ],
                },
            ],
        },
    },
})

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}
