from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from pydantic import BaseModel
from sqlalchemy import func, text
from sqlmodel import Session, SQLModel, col, create_engine, select

from app.config import ARTIFACT_DIR
from app.models.schemas import DecisionAppend, DecisionEntry
from app.storage.models import (
    ArtifactRecord,
    ChatConversationRecord,
    ChatMessageRecord,
    DecisionLogRecord,
)

DB_PATH = ARTIFACT_DIR / "monitor.sqlite"


class ArtifactStore:
    def __init__(self, path: Path | None = None) -> None:
        ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
        self.path = path or DB_PATH
        self._lock = Lock()
        self._engine = create_engine(
            f"sqlite:///{self.path}",
            connect_args={"check_same_thread": False},
        )
        with self._engine.connect() as conn:
            conn.execute(text("PRAGMA journal_mode=WAL"))
            conn.execute(text("PRAGMA foreign_keys=ON"))
            conn.commit()
        SQLModel.metadata.create_all(self._engine)

    def _session(self) -> Session:
        return Session(self._engine)

    def put(self, kind: str, key: str, payload: BaseModel | dict) -> None:
        if isinstance(payload, BaseModel):
            raw = payload.model_dump_json()
        else:
            raw = json.dumps(payload)
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._session() as session:
            row = session.get(ArtifactRecord, (kind, key))
            if row is None:
                session.add(
                    ArtifactRecord(kind=kind, key=key, json=raw, updated_at=now)
                )
            else:
                row.json = raw
                row.updated_at = now
            session.commit()

    def write_json(self, calibration_id: str, name: str, artifact: BaseModel) -> None:
        self.put(name, calibration_id, artifact)

    def get(self, kind: str, key: str) -> dict | None:
        with self._lock, self._session() as session:
            row = session.get(ArtifactRecord, (kind, key))
            if row is None:
                return None
            return json.loads(row.json)

    def append(self, body: DecisionAppend) -> DecisionEntry:
        entry = DecisionEntry(
            ts=datetime.now(timezone.utc).isoformat(),
            type=body.type,
            payload=body.payload,
            evidence_ref=body.evidence_ref,
            human_overridden=body.human_overridden,
        )
        with self._lock, self._session() as session:
            session.add(
                DecisionLogRecord(
                    ts=entry.ts,
                    type=entry.type,
                    payload=json.dumps(entry.payload),
                    evidence_ref=entry.evidence_ref,
                    human_overridden=entry.human_overridden,
                )
            )
            session.commit()
        return entry

    def page(
        self,
        type_filter: str | None = None,
        human_only: bool = False,
        limit: int = 80,
    ) -> tuple[list[DecisionEntry], int]:
        with self._lock, self._session() as session:
            total = session.exec(
                select(func.count()).select_from(DecisionLogRecord)
            ).one()
            stmt = select(DecisionLogRecord)
            if type_filter:
                stmt = stmt.where(col(DecisionLogRecord.type) == type_filter)
            if human_only:
                stmt = stmt.where(col(DecisionLogRecord.human_overridden).is_(True))
            stmt = stmt.order_by(col(DecisionLogRecord.id).desc()).limit(limit)
            rows = session.exec(stmt).all()
        entries = [
            DecisionEntry(
                ts=row.ts,
                type=row.type,  # type: ignore[arg-type]
                payload=json.loads(row.payload),
                evidence_ref=row.evidence_ref,
                human_overridden=bool(row.human_overridden),
            )
            for row in rows
        ]
        return entries, int(total)

    def list_chats(self) -> list[dict]:
        with self._lock, self._session() as session:
            rows = session.exec(
                select(ChatConversationRecord).order_by(
                    col(ChatConversationRecord.updated_at).desc()
                )
            ).all()
            return [
                {
                    "id": row.id,
                    "title": row.title,
                    "created_at": row.created_at,
                    "updated_at": row.updated_at,
                }
                for row in rows
            ]

    def create_chat(self, title: str = "New chat") -> dict:
        now = datetime.now(timezone.utc).isoformat()
        row = ChatConversationRecord(
            id=uuid.uuid4().hex,
            title=(title.strip() or "New chat")[:80],
            created_at=now,
            updated_at=now,
        )
        with self._lock, self._session() as session:
            session.add(row)
            session.commit()
        return {
            "id": row.id,
            "title": row.title,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
            "messages": [],
        }

    def get_chat(self, chat_id: str) -> dict | None:
        with self._lock, self._session() as session:
            conv = session.get(ChatConversationRecord, chat_id)
            if conv is None:
                return None
            rows = session.exec(
                select(ChatMessageRecord)
                .where(col(ChatMessageRecord.conversation_id) == chat_id)
                .order_by(col(ChatMessageRecord.seq))
            ).all()
            messages = [json.loads(row.ui_json) for row in rows]
            return {
                "id": conv.id,
                "title": conv.title,
                "created_at": conv.created_at,
                "updated_at": conv.updated_at,
                "messages": messages,
            }

    def save_chat_messages(self, chat_id: str, messages: list[dict]) -> dict | None:
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._session() as session:
            conv = session.get(ChatConversationRecord, chat_id)
            if conv is None:
                return None
            existing = session.exec(
                select(ChatMessageRecord).where(
                    col(ChatMessageRecord.conversation_id) == chat_id
                )
            ).all()
            for row in existing:
                session.delete(row)
            title = conv.title
            for seq, msg in enumerate(messages):
                parts = msg.get("parts") or []
                texts = [
                    str(p.get("text", ""))
                    for p in parts
                    if isinstance(p, dict) and p.get("type") == "text"
                ]
                content = "\n".join(t for t in texts if t)
                if title in ("", "New chat") and msg.get("role") == "user" and content:
                    title = content.strip().split("\n", 1)[0][:80]
                mid = str(msg.get("id") or uuid.uuid4().hex)
                session.add(
                    ChatMessageRecord(
                        id=f"{chat_id}:{mid}",
                        conversation_id=chat_id,
                        seq=seq,
                        role=str(msg.get("role") or "user"),
                        content=content,
                        ui_json=json.dumps(msg),
                        created_at=now,
                    )
                )
            conv.title = title
            conv.updated_at = now
            session.commit()
            return {
                "id": conv.id,
                "title": conv.title,
                "created_at": conv.created_at,
                "updated_at": conv.updated_at,
            }

    def delete_chat(self, chat_id: str) -> bool:
        with self._lock, self._session() as session:
            conv = session.get(ChatConversationRecord, chat_id)
            if conv is None:
                return False
            rows = session.exec(
                select(ChatMessageRecord).where(
                    col(ChatMessageRecord.conversation_id) == chat_id
                )
            ).all()
            for row in rows:
                session.delete(row)
            session.delete(conv)
            session.commit()
            return True
