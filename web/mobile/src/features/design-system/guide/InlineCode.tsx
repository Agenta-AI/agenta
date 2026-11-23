/** Text from DESIGN.md with its `code` spans shown as code. */
export function InlineCode({text}: {text: string}) {
    return (
        <>
            {text.split("`").map((part, i) =>
                i % 2 ? (
                    <code key={i} className="text-code-sm">
                        {part}
                    </code>
                ) : (
                    part
                ),
            )}
        </>
    )
}
