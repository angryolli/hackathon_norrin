"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { FormEvent, useEffect, useMemo, useState } from "react";

type LogEntry = {
  ts: string;
  kind: string;
  payload: unknown;
};

function partText(part: UIMessage["parts"][number]) {
  if (part.type === "text") return part.text;
  if (part.type.startsWith("tool-")) {
    return `[${part.type}]`;
  }
  return null;
}

export default function Home() {
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    [],
  );

  const { messages, sendMessage, status } = useChat({
    transport,
  });

  async function refreshLog() {
    const res = await fetch("/api/review", { cache: "no-store" });
    if (!res.ok) return;
    const data: { entries: LogEntry[] } = await res.json();
    setLog(data.entries);
  }

  useEffect(() => {
    void refreshLog();
  }, [messages.length]);

  async function review(action: "accept" | "question" | "override") {
    await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note }),
    });
    setNote("");
    await refreshLog();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || status !== "ready") return;
    void sendMessage({ text });
    setInput("");
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-6xl gap-8 p-6 md:grid-cols-[1fr_20rem]">
      <section>
        <h1 className="text-2xl font-semibold">Process monitor</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Agent runs in Next.js. FastAPI only returns statistical artifacts, never
          raw rows.
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="rounded bg-zinc-900 px-3 py-2 text-sm text-white"
            onClick={() =>
              void sendMessage({
                text: "Generate the initial data understanding report from the pipeline artifacts. Start with data quality.",
              })
            }
            disabled={status !== "ready"}
          >
            Run understanding report
          </button>
        </div>

        <div className="mt-6 space-y-4">
          {messages.map((message) => (
            <article key={message.id} className="rounded border border-zinc-200 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                {message.role}
              </p>
              <div className="mt-2 whitespace-pre-wrap text-sm">
                {message.parts.map((part, index) => {
                  const text = partText(part);
                  return text ? <p key={index}>{text}</p> : null;
                })}
              </div>
            </article>
          ))}
        </div>

        <form onSubmit={onSubmit} className="mt-6 flex gap-2">
          <input
            className="flex-1 rounded border border-zinc-300 px-3 py-2"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask why a flag fired, or challenge a diagnosis"
          />
          <button
            type="submit"
            className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50"
            disabled={status !== "ready"}
          >
            Send
          </button>
        </form>
      </section>

      <aside className="space-y-4">
        <section className="rounded border border-zinc-200 p-3">
          <h2 className="font-medium">Human review</h2>
          <textarea
            className="mt-2 w-full rounded border border-zinc-300 p-2 text-sm"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional note"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border px-2 py-1 text-sm"
              onClick={() => void review("accept")}
            >
              Accept
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 text-sm"
              onClick={() => void review("question")}
            >
              Question
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 text-sm"
              onClick={() => void review("override")}
            >
              Override
            </button>
          </div>
        </section>

        <section className="rounded border border-zinc-200 p-3">
          <h2 className="font-medium">Decision log</h2>
          <ul className="mt-2 space-y-2 text-xs">
            {log.map((entry, index) => (
              <li key={`${entry.ts}-${index}`} className="border-t border-zinc-100 pt-2">
                <p className="text-zinc-500">
                  {entry.kind} · {entry.ts}
                </p>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(entry.payload)}
                </pre>
              </li>
            ))}
            {log.length === 0 && (
              <li className="text-zinc-500">No decisions yet.</li>
            )}
          </ul>
        </section>
      </aside>
    </main>
  );
}
