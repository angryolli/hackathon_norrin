# Agents

Two separate Node-side agents. They do not import each other.

## Operator agent (`agents/operator`)

On-demand chat on `/agent`. The browser posts to `POST /api/chat`; this process runs the tool loop and talks to the LLM. It answers operator questions from diagnosis artifacts. It does not run in the background.

## System agent (`agents/system`)

Background loop in this same Next.js Node process. Launch and stop it from System Monitor (`Launch system agent`). Control API: `GET` / `POST /api/system-agent`. Inference and decision logic is not wired yet; the loop only keeps a running flag and heartbeat until that lands.

Do not call operator chat code from the system agent, or the other way around.
