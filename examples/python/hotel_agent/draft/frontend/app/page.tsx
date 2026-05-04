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
  PromptInputBody,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Loader } from "@/components/ai-elements/loader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { CopyIcon, RefreshCcwIcon, Trash2Icon } from "lucide-react";

// --- Personas ----------------------------------------------------------------

type Persona = {
  id: string;
  name: string;
  tier: "Standard" | "Gold" | "Platinum";
  hint: string;
};

const PERSONAS: Persona[] = [
  { id: "guest_sarah", name: "Sarah Smith",   tier: "Standard", hint: "1 future flexible booking" },
  { id: "guest_bob",   name: "Bob Brown",     tier: "Standard", hint: "2 bookings (one inside cutoff)" },
  { id: "guest_carla", name: "Carla Chen",    tier: "Gold",     hint: "past + future non-refundable" },
  { id: "guest_dan",   name: "Dan Davis",     tier: "Gold",     hint: "1 future flexible booking" },
  { id: "guest_eve",   name: "Eve Edwards",   tier: "Platinum", hint: "currently in-stay + future" },
  { id: "guest_frank", name: "Frank Foster",  tier: "Platinum", hint: "no reservations yet" },
  { id: "guest_grace", name: "Grace Green",   tier: "Standard", hint: "no reservations yet" },
];

const tierColor = (tier: Persona["tier"]) =>
  tier === "Platinum" ? "bg-purple-100 text-purple-800"
  : tier === "Gold"   ? "bg-yellow-100 text-yellow-800"
  : "bg-gray-100 text-gray-800";

// --- Page --------------------------------------------------------------------

export default function Chat() {
  const [input, setInput] = useState("");
  const [persona, setPersona] = useState<string>("guest_sarah");
  const [runtime, setRuntime] = useState<string>("pydanticai_vanilla");
  const [runtimes, setRuntimes] = useState<string[]>(["pydanticai_vanilla"]);

  // Discover available runtimes from the backend.
  useEffect(() => {
    fetch("/api/runtimes")
      .then((r) => (r.ok ? r.json() : { runtimes: [] }))
      .then((j) => {
        if (Array.isArray(j.runtimes) && j.runtimes.length) {
          setRuntimes(j.runtimes);
          if (!j.runtimes.includes(runtime)) setRuntime(j.runtimes[0]);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { messages, sendMessage, status, regenerate, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: `/api/chat/${runtime}`,
      body: { current_user_id: persona },
    }),
    onError: (error) => console.error("useChat error:", error),
  });

  // Reset the conversation when persona or runtime changes — different
  // backend session, no useful continuity.
  useEffect(() => {
    setMessages([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona, runtime]);

  const handleSubmit = (m: PromptInputMessage) => {
    const text = m.text?.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  };

  const currentPersona = PERSONAS.find((p) => p.id === persona) ?? PERSONAS[0];

  return (
    <div className="max-w-4xl mx-auto p-6 relative size-full h-screen">
      <div className="flex flex-col h-full">
        {/* Header */}
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-800">
              Hotel Concierge — The Agenta Grand Hotel
            </h1>
            <p className="text-sm text-gray-500">
              Demo agent. Switch personas to see how policy adapts to tier.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Runtime switcher */}
            <Select value={runtime} onValueChange={setRuntime}>
              <SelectTrigger className="w-[220px]" aria-label="Runtime">
                <SelectValue placeholder="Runtime" />
              </SelectTrigger>
              <SelectContent>
                {runtimes.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Persona switcher */}
            <Select value={persona} onValueChange={setPersona}>
              <SelectTrigger className="w-[260px]" aria-label="Persona">
                <SelectValue placeholder="Persona">
                  <span className="flex items-center gap-2">
                    {currentPersona.name}
                    <Badge className={tierColor(currentPersona.tier)} variant="secondary">
                      {currentPersona.tier}
                    </Badge>
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PERSONAS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span>{p.name}</span>
                        <Badge className={tierColor(p.tier)} variant="secondary">{p.tier}</Badge>
                      </div>
                      <span className="text-xs text-gray-500">{p.hint}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
                title="Clear conversation"
              >
                <Trash2Icon className="size-4" />
              </button>
            )}
          </div>
        </header>

        {/* Conversation */}
        <Conversation className="h-full">
          <ConversationContent>
            {messages.length === 0 && (
              <div className="text-center text-gray-400 mt-20">
                <p>Try: &quot;Show me available rooms next week&quot; or &quot;What&apos;s your pet policy?&quot;</p>
              </div>
            )}

            {messages.map((message) => (
              <div key={message.id}>
                {message.parts.map((part, i) => {
                  // Tool calls (typed or dynamic). The Python backend emits
                  // `dynamic-tool` parts because tools aren't statically declared
                  // on the JS side.
                  if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
                    const p = part as {
                      type: string;
                      toolCallId?: string;
                      toolName?: string;
                      state: "input-streaming" | "input-available" | "output-available" | "output-error";
                      input?: unknown;
                      output?: unknown;
                      errorText?: string;
                    };
                    return (
                      <Tool
                        key={`${message.id}-${i}`}
                        defaultOpen={p.state === "output-error"}
                      >
                        <ToolHeader
                          type={(p.toolName ? `tool-${p.toolName}` : p.type) as `tool-${string}`}
                          state={p.state}
                        />
                        <ToolContent>
                          <ToolInput input={p.input} />
                          <ToolOutput output={p.output as React.ReactNode} errorText={p.errorText} />
                        </ToolContent>
                      </Tool>
                    );
                  }

                  // Text parts
                  if (part.type === "text") {
                    return (
                      <Message key={`${message.id}-${i}`} from={message.role}>
                        <MessageContent>
                          <MessageResponse>{part.text}</MessageResponse>
                        </MessageContent>
                        {message.role === "assistant" &&
                          i === message.parts.length - 1 && (
                            <MessageActions>
                              <MessageAction
                                onClick={() => regenerate()}
                                label="Retry"
                              >
                                <RefreshCcwIcon className="size-3" />
                              </MessageAction>
                              <MessageAction
                                onClick={() => navigator.clipboard.writeText(part.text)}
                                label="Copy"
                              >
                                <CopyIcon className="size-3" />
                              </MessageAction>
                            </MessageActions>
                          )}
                      </Message>
                    );
                  }

                  return null;
                })}
              </div>
            ))}

            {status === "submitted" && <Loader />}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {/* Input */}
        <PromptInput onSubmit={handleSubmit} className="mt-4">
          <PromptInputBody>
            <PromptInputTextarea
              onChange={(e) => setInput(e.target.value)}
              value={input}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools />
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
