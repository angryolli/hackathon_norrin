"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChatMarkdown } from "@/components/chat-markdown";
import {
  browserDelete,
  browserGet,
  browserPost,
  browserPut,
  type ChatDetail,
  type ChatSummary,
} from "@/lib/browser-api";
import { cn } from "@/lib/utils";

function partText(part: UIMessage["parts"][number]) {
  if (part.type === "text") return part.text;
  return null;
}

function toUiMessages(raw: ChatDetail["messages"]): UIMessage[] {
  return raw.map((m) => ({
    id: m.id,
    role: m.role as UIMessage["role"],
    parts: (m.parts?.length
      ? m.parts
      : [{ type: "text", text: "" }]) as UIMessage["parts"],
  }));
}

function serializeMessages(messages: UIMessage[]) {
  return JSON.parse(
    JSON.stringify(
      messages.map((m) => ({
        id: m.id,
        role: m.role,
        parts: m.parts,
      })),
    ),
  );
}

export function ChatView() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [threadKey, setThreadKey] = useState("draft");
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);

  async function refreshChats() {
    try {
      setChats(await browserGet<ChatSummary[]>("/chats"));
    } catch {
      setChats([]);
    }
  }

  useEffect(() => {
    void refreshChats();
  }, []);

  async function openChat(id: string) {
    const detail = await browserGet<ChatDetail>(`/chats/${id}`);
    setActiveId(id);
    setInitialMessages(toUiMessages(detail.messages));
    setThreadKey(id);
  }

  function newChat() {
    setActiveId(null);
    setInitialMessages([]);
    setThreadKey(`draft-${Date.now()}`);
  }

  async function removeChat(id: string) {
    await browserDelete(`/chats/${id}`);
    if (activeId === id) newChat();
    await refreshChats();
  }

  return (
    <div className="flex h-full min-h-0">
      <ChatPane
        key={threadKey}
        conversationId={activeId}
        initialMessages={initialMessages}
        onPersisted={(id) => {
          setActiveId(id);
          void refreshChats();
        }}
      />
      <aside className="flex h-full w-64 shrink-0 flex-col border-l border-border bg-background">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">History</p>
          <Button size="icon-sm" variant="ghost" onClick={newChat} aria-label="New chat">
            <Plus />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {chats.length === 0 && (
            <p className="px-2 pt-4 text-xs text-muted-foreground">No saved chats yet.</p>
          )}
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={cn(
                "group mb-1 flex items-center rounded-lg",
                activeId === chat.id ? "bg-secondary" : "hover:bg-muted/50",
              )}
            >
              <button
                type="button"
                onClick={() => void openChat(chat.id)}
                className="min-w-0 flex-1 px-2 py-2 text-left"
              >
                <p className="truncate text-sm">{chat.title || "New chat"}</p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  {chat.updated_at.slice(0, 16).replace("T", " ")}
                </p>
              </button>
              <Button
                size="icon-xs"
                variant="ghost"
                className="mr-1 opacity-0 group-hover:opacity-100"
                aria-label="Delete chat"
                onClick={() => void removeChat(chat.id)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function ChatPane({
  conversationId,
  initialMessages,
  onPersisted,
}: {
  conversationId: string | null;
  initialMessages: UIMessage[];
  onPersisted: (id: string) => void;
}) {
  const params = useSearchParams();
  const context = params.get("context");
  const [input, setInput] = useState(
    context ? `Why was ${context} flagged? Check overrides in the decision log.` : "",
  );
  const listRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(conversationId);
  idRef.current = conversationId ?? idRef.current;

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    [],
  );
  const { messages, sendMessage, status } = useChat({
    messages: initialMessages,
    transport,
    onFinish: async ({ messages: next }) => {
      try {
        let id = idRef.current;
        if (!id) {
          const created = await browserPost<ChatDetail>("/chats", { title: "New chat" });
          id = created.id;
          idRef.current = id;
        }
        await browserPut(`/chats/${id}/messages`, {
          messages: serializeMessages(next),
        });
        onPersisted(id);
      } catch {
        /* keep chatting even if persist fails */
      }
    },
  });
  const busy = status !== "ready";

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    void sendMessage({ text });
    setInput("");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {messages.length === 0 && (
            <p className="pt-8 text-center text-sm text-muted-foreground">
              Ask why a flag fired. Answers come from artifacts only.
            </p>
          )}
          {messages.map((message) => {
            const fromUser = message.role === "user";
            const texts = message.parts.map(partText).filter((t): t is string => Boolean(t));
            if (!texts.length) return null;
            return (
              <article
                key={message.id}
                className={cn("flex w-full", fromUser ? "justify-end pl-16" : "justify-start pr-16")}
              >
                <div
                  className={cn(
                    "max-w-[min(36rem,100%)] rounded-2xl px-3 py-2 text-sm",
                    fromUser
                      ? "bg-secondary text-secondary-foreground"
                      : "border border-border bg-card text-card-foreground",
                  )}
                >
                  <p className="mb-1 text-[10px] tracking-wide text-muted-foreground uppercase">
                    {fromUser ? "You" : "Assistant"}
                  </p>
                  <div>
                    {texts.map((text, i) => (
                      <ChatMarkdown key={i} text={text} />
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
          {busy && <p className="pl-1 text-xs text-muted-foreground">Thinking…</p>}
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="shrink-0 border-t border-border bg-background px-4 py-3"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask why a flag fired"
            rows={1}
            disabled={busy}
            className="max-h-24 min-h-10 flex-1 resize-none overflow-y-auto rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          />
          <Button
            type="submit"
            size="icon"
            disabled={busy || !input.trim()}
            aria-label="Send"
          >
            {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
      </form>
    </div>
  );
}
