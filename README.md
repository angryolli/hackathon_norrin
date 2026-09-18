# Trustworthy process monitor

Next.js owns the LLM agent. FastAPI only computes statistical artifacts. Raw rows never go to the model.

`data_processing/` is for notebooks and experiments only.

First time: `cd backend && uv sync`, then `cd frontend && npm install`. Put an API key in `frontend/.env`.

**Backend** (from `backend/`):

```bash
uv run uvicorn main:app --reload --app-dir src --host 0.0.0.0 --port 8000
```

**Frontend** (from `frontend/`):

```bash
npm run dev
```
