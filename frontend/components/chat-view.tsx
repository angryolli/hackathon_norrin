"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function partText(part: UIMessage["parts"][number]) {
  if (part.type === "text") return part.text;
  if (part.type.startsWith("tool-")) return part.type.replace("tool-", "");
  return null;
}

export function ChatView() {
  const params = useSearchParams();
  const context = params.get("context");
  const [input, setInput] = useState(
    context ? `Why was ${context} flagged? Check overrides in the decision log.` : "",
  );
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    [],
  );
  const { messages, sendMessage, status } = useChat({ transport });
  const busy = status !== "ready";

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    void sendMessage({ text });
    setInput("");
  }

  return (
    <div className="mx-auto flex min-h-[calc(100svh-3rem)] max-w-3xl flex-col p-4">
      <div className="flex-1 space-y-3">
        {messages.map((message) => (
          <article key={message.id} className="rounded-lg border border-border p-3">
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
              {message.role}
            </p>
            <div className="mt-1 space-y-1 whitespace-pre-wrap text-sm">
              {message.parts.map((part, i) => {
                const text = partText(part);
                return text ? <p key={i}>{text}</p> : null;
              })}
            </div>
          </article>
        ))}
      </div>
      <form onSubmit={onSubmit} className="mt-4 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask why a flag fired"
        />
        <Button type="submit" disabled={busy || !input.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
