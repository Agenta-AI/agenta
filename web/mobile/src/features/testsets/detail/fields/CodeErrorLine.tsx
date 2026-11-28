import {codeErrorText, type CodeFormat, type CodeParseError} from "@agenta/entity-ui/testcase"

/** The line under a code field whose text does not parse: the problem and its line. */
export const CodeErrorLine = ({error, format}: {error: CodeParseError; format: CodeFormat}) => (
    <p role="alert" className="m-0 pl-1 text-meta text-destructive">
        {codeErrorText(error, format)}
    </p>
)
