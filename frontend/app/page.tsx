import { EchoForm } from "./echo-form";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function getHealth() {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
    if (!res.ok) return `HTTP ${res.status}`;
    const data: { status: string } = await res.json();
    return data.status;
  } catch (err) {
    return `unreachable (${err instanceof Error ? err.message : "error"})`;
  }
}

export default async function Home() {
  const health = await getHealth();

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">Hackathon Norrin</h1>
      <p className="mt-2 text-zinc-600">GET /health: {health}</p>
      <EchoForm />
    </main>
  );
}
