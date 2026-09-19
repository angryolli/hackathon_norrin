from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from pydantic import BaseModel
from sqlalchemy import func, text
from sqlmodel import Session, SQLModel, col, create_engine, select

from app.config import ARTIFACT_DIR, DEFAULT_DATA_SOURCES
from app.models.schemas import DecisionAppend, DecisionEntry
from app.storage.models import (
    ArtifactRecord,
    ChatConversationRecord,
    ChatMessageRecord,
    DataSourceRecord,
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
        self._migrate_data_sources()

    def _session(self) -> Session:
        return Session(self._engine)

    def _migrate_data_sources(self) -> None:
        with self._engine.connect() as conn:
            rows = conn.execute(text("PRAGMA table_info(data_sources)")).fetchall()
            names = {row[1] for row in rows}
            additions = {
                "origin": "TEXT DEFAULT 'file'",
                "api_url": "TEXT DEFAULT ''",
                "file_path": "TEXT DEFAULT ''",
                "x_column": "TEXT DEFAULT ''",
                "y_columns": "TEXT DEFAULT '[]'",
            }
            for col_name, ddl in additions.items():
                if col_name not in names:
                    conn.execute(text(f"ALTER TABLE data_sources ADD COLUMN {col_name} {ddl}"))
            conn.commit()

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

    def _source_dict(self, row: DataSourceRecord) -> dict:
        raw_y = getattr(row, "y_columns", None) or "[]"
        try:
            y_columns = json.loads(raw_y) if isinstance(raw_y, str) else list(raw_y)
        except (TypeError, ValueError):
            y_columns = []
        if not isinstance(y_columns, list):
            y_columns = []
        return {
            "id": row.id,
            "name": row.name,
            "kind": row.kind,
            "description": row.description,
            "generator": row.generator,
            "origin": getattr(row, "origin", None) or "file",
            "api_url": getattr(row, "api_url", None) or "",
            "file_path": getattr(row, "file_path", None) or "",
            "train_path": row.train_path,
            "live_path": row.live_path,
            "x_column": getattr(row, "x_column", None) or "",
            "y_columns": [str(c) for c in y_columns],
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    def seed_data_sources(self) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._session() as session:
            existing = session.exec(select(DataSourceRecord)).first()
            if existing is not None:
                return
            for spec in DEFAULT_DATA_SOURCES:
                session.add(
                    DataSourceRecord(
                        id=spec["id"],
                        name=spec["name"],
                        kind=spec["kind"],
                        description=spec["description"],
                        generator=spec["generator"],
                        origin=spec.get("origin") or "file",
                        api_url=spec.get("api_url") or "",
                    file_path=spec.get("file_path") or "",
                    train_path=spec["train_path"],
                    live_path=spec["live_path"],
                    x_column=spec.get("x_column") or "",
                    y_columns=json.dumps(spec.get("y_columns") or []),
                        created_at=now,
                        updated_at=now,
                    )
                )
            session.commit()

    def list_data_sources(self) -> list[dict]:
        with self._lock, self._session() as session:
            rows = session.exec(select(DataSourceRecord).order_by(DataSourceRecord.created_at)).all()
            return [self._source_dict(row) for row in rows]

    def get_data_source(self, source_id: str) -> dict | None:
        with self._lock, self._session() as session:
            row = session.get(DataSourceRecord, source_id)
            return None if row is None else self._source_dict(row)

    def create_data_source(self, body: dict) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._session() as session:
            session.add(
                DataSourceRecord(
                    id=body["id"],
                    name=body["name"],
                    kind=body.get("kind") or "process",
                    description=body.get("description") or "",
                    generator=body.get("generator") or "industrial",
                    origin=body.get("origin") or "file",
                    api_url=body.get("api_url") or "",
                    file_path=body.get("file_path") or "",
                    train_path=body["train_path"],
                    live_path=body["live_path"],
                    x_column=body.get("x_column") or "",
                    y_columns=json.dumps(body.get("y_columns") or []),
                    created_at=now,
                    updated_at=now,
                )
            )
            session.commit()
            row = session.get(DataSourceRecord, body["id"])
            assert row is not None
            return self._source_dict(row)

    def update_data_source(self, source_id: str, body: dict) -> dict | None:
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._session() as session:
            row = session.get(DataSourceRecord, source_id)
            if row is None:
                return None
            if "name" in body and body["name"] is not None:
                row.name = body["name"]
            if "kind" in body and body["kind"] is not None:
                row.kind = body["kind"]
            if "description" in body and body["description"] is not None:
                row.description = body["description"]
            if "generator" in body and body["generator"] is not None:
                row.generator = body["generator"]
            if "origin" in body and body["origin"] is not None:
                row.origin = body["origin"]
            if "api_url" in body and body["api_url"] is not None:
                row.api_url = body["api_url"]
            if "file_path" in body and body["file_path"] is not None:
                row.file_path = body["file_path"]
            if "x_column" in body and body["x_column"] is not None:
                row.x_column = body["x_column"]
            if "y_columns" in body and body["y_columns"] is not None:
                cols = body["y_columns"]
                row.y_columns = json.dumps(cols if isinstance(cols, list) else [])
            row.updated_at = now
            session.add(row)
            session.commit()
            session.refresh(row)
            return self._source_dict(row)

    def delete_data_source(self, source_id: str) -> bool:
        with self._lock, self._session() as session:
            row = session.get(DataSourceRecord, source_id)
            if row is None:
                return False
            session.delete(row)
            session.commit()
            return True
