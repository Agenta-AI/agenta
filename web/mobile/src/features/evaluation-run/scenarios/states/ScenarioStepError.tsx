/** The error of a step that failed, in a table cell or a card: cut to two lines, whole on hover. */
export const ScenarioStepError = ({message}: {message: string}) => (
    <p
        role="alert"
        title={message}
        className="m-0 break-words text-xs text-destructive"
        style={{
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            overflow: "hidden",
        }}
    >
        {message}
    </p>
)
