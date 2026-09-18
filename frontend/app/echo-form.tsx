"use client";

import { FormEvent, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function EchoForm() {
  const [message, setMessage] = useState("");
  const [echo, setEcho] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setEcho(null);

    try {
      const res = await fetch(`${API_URL}/echo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { echo: string } = await res.json();
      setEcho(data.echo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="mt-8 flex gap-2">
        <input
          className="flex-1 rounded border border-zinc-300 px-3 py-2"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="POST /echo"
          required
        />
        <button
          type="submit"
          className="rounded bg-zinc-900 px-4 py-2 text-white"
        >
          Send
        </button>
      </form>
      {echo !== null && <p className="mt-4">echo: {echo}</p>}
      {error !== null && <p className="mt-4 text-red-600">{error}</p>}
    </>
  );
}
