"""ChatGPT Handover — dashboard plugin backend, mounted at /api/plugins/chatgpt-handover/.

Reached by the Desktop pane through ``ctx.rest`` (the dashboard's own auth applies). Reads the
store the inbox writes; never talks to chatgpt.com and never sends content anywhere — a handover
only reaches a model when the user presses Send in a Hermes chat.

No ``from __future__ import annotations`` here: pydantic must resolve the body model eagerly,
whatever module name the dashboard loader registers this file under.
"""
import importlib.util
import sys
import time
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

_here = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("chatgpt_handover_core", _here / "core.py")
core = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
sys.modules["chatgpt_handover_core"] = core
_spec.loader.exec_module(core)  # type: ignore[union-attr]

router = APIRouter()


def _check(cid: str) -> str:
    if not core.valid_id(cid):
        raise HTTPException(status_code=400, detail="invalid conversation id")
    return cid


@router.get("/status")
def status():
    idx = core.load_index()
    sync = idx.get("sync") or {}
    at = sync.get("at")
    return {
        "sync": sync,
        "age_seconds": (time.time() - at) if at else None,
        "conversations": sum(1 for c in idx["conversations"].values() if not c.get("deleted")),
        "with_content": sum(1 for c in idx["conversations"].values() if c.get("content_update_time")),
        "data_dir": str(core.data_dir()),
    }


@router.get("/conversations")
def conversations(q: str = "", archived: bool = False, limit: int = 200):
    return core.list_conversations(q, include_archived=archived, limit=max(1, min(limit, 500)))


@router.get("/conversation/{cid}/outline")
def outline(cid: str):
    try:
        return core.message_outline(_check(cid))
    except LookupError:
        raise HTTPException(status_code=404, detail="content not synced yet")


@router.post("/conversation/{cid}/request")
def request(cid: str):
    core.request_content(_check(cid))
    core.request_refresh()
    return {"ok": True}


@router.post("/refresh")
def refresh():
    """Page open / Refresh button. The collector throttles to one on-demand sync per 30 s."""
    core.request_refresh()
    return {"ok": True}


class HandoverBody(BaseModel):
    id: str
    include: Optional[List[int]] = None
    include_tools: bool = False
    note: str = Field(default="", max_length=4000)
    max_chars: int = Field(default=300_000, ge=5_000, le=1_000_000)


def _build(body: HandoverBody):
    try:
        return core.build_handover(
            _check(body.id),
            include=body.include,
            include_tools=body.include_tools,
            note=body.note,
            max_chars=body.max_chars,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="content not synced yet")


@router.post("/handover/preview")
def preview(body: HandoverBody):
    return _build(body)


@router.post("/handover/save")
def save(body: HandoverBody):
    """Persist the handover as Markdown and return the composer text that references it."""
    res = _build(body)
    path = core.save_handover(body.id, res["markdown"], res["title"])
    res["path"] = str(path)
    res["composer_text"] = (
        f"Continuing from a ChatGPT conversation — handover attached: @file:`{path}`\n\n"
        "Read it, write the brief it asks for, then ask me how to proceed."
    )
    return res


@router.post("/forget")
def forget():
    return {"removed": core.forget_all()}
