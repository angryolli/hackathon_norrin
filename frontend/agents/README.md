# Agents

Two Node-side agents in this Next.js process. They do not import each other.

| | Operator | System |
|---|---|---|
| Folder | `agents/operator` | `agents/system` |
| Where | `/agent` chat | System Dashboard → **Launch system agent** |
| Trigger | Operator sends a message | Manual cycle (demo). Same `runCycle()` will be on a timer for 24/7 later. |
| Job | Human-in-the-loop language | Autonomous pipeline |

## Operator (`agents/operator`)

Plain-language interface. The operator asks why a flag fired, challenges a conclusion, or pastes a rule in words. The model only answers from diagnosis artifacts and the decision log. It does not generate the understanding report, quality report, or root-cause diagnosis on its own.

Human **accept / question / override** lives on System Dashboard (Judgment). Questions also open this chat.

## System (`agents/system`)

The autonomous reliability loop. One **Launch** run, in order, over derived fingerprints (never raw rows):

1. **Understanding** — unlabeled field roles, inferred vs assumed vs uncertain, evidence, confidence
2. **Quality** — completeness / validity / consistency / timeliness as far as the moment table supports; separate broken data from process drift; `DATA_TRUSTED: yes|no`
3. **Root cause** — fault type, ranked fields, operator-readable steps, then a critique of that diagnosis

Drift yellow/red flags themselves come from the FastAPI expanding-moment engine, not the LLM. The system agent narrates and attributes them.

Demo scheduler: launch runs **one cycle** then stops (no token burn). Continuous looping is a scheduler change only.

## Challenge map

| Expected output | Owner | Where you look |
|---|---|---|
| 1 Sensor understanding report | System agent | Telemetry → click a source |
| 2 Data quality checks | System agent | Telemetry → click a source (that field only) |
| 3 Drift / anomaly | Compute plane + system narration | System Dashboard → Alerts (inspect stream on Telemetry) |
| 4 Root-cause diagnosis | System agent (+ critique) | System Dashboard → Root cause |
| 5 Human review | Operator (controls) | System Dashboard → Judgment; questions also `/agent` |
| 6 Decision log | Both (model calls + overrides) | Reports & Logs → Decision log |
| 7 Adaptability | Architecture (unlabeled columns, source `kind`) | Reports & Logs → Data flow |
| 8 Data-flow record | Node LLM layer | Reports & Logs → Data flow |
