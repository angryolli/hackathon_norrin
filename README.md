# Trustworthy process monitor

FastAPI is the compute plane (raw data stays there). Next.js is the reasoning plane (LLM sees artifacts only).

First time: `cd backend && uv sync`, then `cd frontend && npm install`. Copy `frontend/.env.example` to `frontend/.env`.

**Backend** (from `backend/`):

```bash
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Frontend** (from `frontend/`):

```bash
npm run dev
```

The backend emits a rolling unlabeled data-source stream while it runs. Manage sources on the Data page (`industrial_stream`, `expenses`, or ones you add) — same pipeline code, different CSV pointer.
