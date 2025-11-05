import React from "react";
import CodeBlock from "@theme/CodeBlock";

type ResponseSamplesProps = {
  responseExample?: string | Record<string, unknown> | Array<unknown>;
  language?: string;
  title?: string;
  className?: string;
};

function formatExample(
  example: ResponseSamplesProps["responseExample"]
): string {
  if (example == null) {
    return "";
  }

  if (typeof example === "string") {
    return example;
  }

  try {
    return JSON.stringify(example, null, 2);
  } catch (error) {
    console.warn("Failed to stringify responseExample:", error);
    return "";
  }
}

export default function ResponseSamples({
  responseExample,
  language = "json",
  title,
  className,
}: ResponseSamplesProps) {
  const formattedExample = formatExample(responseExample);

  if (!formattedExample) {
    return null;
  }

  return (
    <CodeBlock language={language} title={title} className={className}>
      {formattedExample}
    </CodeBlock>
  );
}
