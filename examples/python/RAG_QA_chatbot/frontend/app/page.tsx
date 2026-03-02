"use client";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { CopyIcon, ExternalLinkIcon, RefreshCcwIcon, Trash2Icon } from "lucide-react";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Loader } from "@/components/ai-elements/loader";

export default function Chat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, regenerate, setMessages } = useChat({
    // Use relative URL - Next.js rewrites to backend
    api: "/api/chat",
    onError: (error) => {
      console.error("useChat error:", error);
    },
  });

  const handleSubmit = (message: PromptInputMessage) => {
    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return;
    }

    sendMessage(
      {
        text: message.text || "Sent with attachments",
        files: message.files,
      },
      {}
    );
    setInput("");
  };

  return (
    <div className="max-w-4xl mx-auto p-6 relative size-full h-screen">
      <div className="flex flex-col h-full">
        {/* Header */}
        <header className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-800">
              Documentation Chatbot
            </h1>
            <p className="text-sm text-gray-500">
              Ask questions about the documentation
            </p>
          </div>
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
              title="Clear conversation"
            >
              <Trash2Icon className="size-4" />
              <span>Clear</span>
            </button>
          )}
        </header>

        <Conversation className="h-full">
          <ConversationContent>
            {messages.length === 0 && (
              <div className="text-center text-gray-400 mt-20">
                <p>Ask a question to get started</p>
              </div>
            )}

            {messages.map((message) => (
              <div key={message.id}>
                {message.role === "assistant" &&
                  message.parts.filter((part) => part.type === "source-url")
                    .length > 0 && (
                    <Sources>
                      <SourcesTrigger
                        count={
                          message.parts.filter(
                            (part) => part.type === "source-url"
                          ).length
                        }
                      />
                      <SourcesContent>
                        {message.parts
                          .filter((part) => part.type === "source-url")
                          .map((part, i) => (
                            <Source
                              key={`${message.id}-${i}`}
                              href={part.url}
                              title={part.url}
                            />
                          ))}
                      </SourcesContent>
                    </Sources>
                  )}

                {message.parts.map((part, i) => {
                  switch (part.type) {
                    case "text":
                      // Find trace URL from data-trace part if exists
                      const tracePart = message.parts.find(
                        (p) => p.type === "data-trace"
                      ) as { type: "data-trace"; data: { url: string } } | undefined;
                      const traceUrl = tracePart?.data?.url;

                      return (
                        <Message
                          key={`${message.id}-${i}`}
                          from={message.role}
                        >
                          <MessageContent>
                            <MessageResponse>{part.text}</MessageResponse>
                          </MessageContent>
                          {message.role === "assistant" &&
                            (i === message.parts.length - 1 ||
                              message.parts
                                .slice(i + 1)
                                .every((p) => p.type === "data-trace")) &&
                            messages.length > 0 && (
                              <MessageActions>
                                <MessageAction
                                  onClick={() => regenerate()}
                                  label="Retry"
                                >
                                  <RefreshCcwIcon className="size-3" />
                                </MessageAction>
                                <MessageAction
                                  onClick={() =>
                                    navigator.clipboard.writeText(part.text)
                                  }
                                  label="Copy"
                                >
                                  <CopyIcon className="size-3" />
                                </MessageAction>
                                {traceUrl && (
                                  <MessageAction
                                    onClick={() => window.open(traceUrl, "_blank")}
                                    label="View Trace"
                                    tooltip="View trace in Agenta"
                                  >
                                    <ExternalLinkIcon className="size-3" />
                                  </MessageAction>
                                )}
                              </MessageActions>
                            )}
                        </Message>
                      );
                    case "reasoning":
                      return (
                        <Reasoning
                          key={`${message.id}-${i}`}
                          className="w-full"
                          isStreaming={
                            status === "streaming" &&
                            i === message.parts.length - 1 &&
                            message.id === messages.at(-1)?.id
                          }
                        >
                          <ReasoningTrigger />
                          <ReasoningContent>{part.text}</ReasoningContent>
                        </Reasoning>
                      );
                    case "data-trace":
                      // Handled inline with text part above
                      return null;
                    default:
                      return null;
                  }
                })}
              </div>
            ))}

            {status === "submitted" && <Loader />}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <PromptInput
          onSubmit={handleSubmit}
          className="mt-4"
          globalDrop
          multiple
        >
          <PromptInputHeader>
            <PromptInputAttachments>
              {(attachment) => <PromptInputAttachment data={attachment} />}
            </PromptInputAttachments>
          </PromptInputHeader>
          <PromptInputBody>
            <PromptInputTextarea
              onChange={(e) => setInput(e.target.value)}
              value={input}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
            </PromptInputTools>
            <PromptInputSubmit
              disabled={!input && status !== "submitted"}
              status={status}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
