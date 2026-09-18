# Hackathon Norrin

First time: `cd backend && uv sync`, then `cd frontend && npm install`.

**Backend** (from `backend/`):

```bash
uv run uvicorn main:app --reload --app-dir src --host 0.0.0.0 --port 8000
```

**Frontend** (from `frontend/`):

```bash
npm run dev
```
