#!/usr/bin/env python3
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
DATA_FILE = sys.argv[1] if len(sys.argv) > 1 else "data/projects.json"
IMPORTS_FILE = sys.argv[2] if len(sys.argv) > 2 else "tools/supabase/selected_imports.json"

if not SUPABASE_URL or not SERVICE_KEY:
    print("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
    sys.exit(2)

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
}


def request(method, path, payload=None, prefer=None):
    h = dict(HEADERS)
    if prefer:
        h["Prefer"] = prefer
    r = requests.request(method, f"{SUPABASE_URL}/rest/v1/{path}", headers=h, data=json.dumps(payload) if payload is not None else None, timeout=120)
    if not r.ok:
        raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text}")
    return r.json() if r.text else None


def chunks(items, size=500):
    for i in range(0, len(items), size):
        yield items[i:i+size]


def infer_parent_uid(project_id, outline, by_outline):
    if not outline or "." not in str(outline):
        return None
    parent_outline = str(outline).rsplit(".", 1)[0]
    return by_outline.get(parent_outline)


def iso_or_none(value):
    return value or None

with open(DATA_FILE, "r", encoding="utf-8") as f:
    data = json.load(f)

try:
    with open(IMPORTS_FILE, "r", encoding="utf-8") as f:
        selected_imports = json.load(f)
except FileNotFoundError:
    selected_imports = []

import_by_project = {x.get("project_slug"): x.get("id") for x in selected_imports}
now = datetime.now(timezone.utc).isoformat()

for project in data.get("projects", []):
    pid = project.get("id")
    if not pid:
        continue
    tasks = project.get("tasks", [])
    import_id = import_by_project.get(pid)

    project_row = {
        "id": pid,
        "slug": pid,
        "name": project.get("name") or project.get("title") or pid,
        "short": project.get("short") or project.get("name") or pid,
        "description": project.get("description"),
        "source_file": project.get("source_file"),
        "title": project.get("title"),
        "author": project.get("author"),
        "start_at": iso_or_none(project.get("start")),
        "finish_at": iso_or_none(project.get("finish")),
        "creation_date": iso_or_none(project.get("creation_date")),
        "last_saved_at": iso_or_none(project.get("last_saved")),
        "storage_folder": pid,
        "active": True,
        "raw": project,
    }
    if import_id:
        project_row["last_import_id"] = import_id
        project_row["last_import_at"] = now

    request("POST", "projects?on_conflict=id", [project_row], prefer="resolution=merge-duplicates,return=minimal")

    # Ocultar tareas anteriores del proyecto; las tareas importadas se reactivan con hidden=false.
    request("PATCH", f"tasks?project_id=eq.{pid}", {"hidden": True}, prefer="return=minimal")

    by_outline = {str(t.get("outline")): t.get("uid") for t in tasks if t.get("uid")}
    rows = []
    for idx, t in enumerate(tasks):
        uid = t.get("uid") or f"{pid}-{t.get('unique_id') or t.get('task_id') or idx}"
        row_raw = json.dumps(t, sort_keys=True, ensure_ascii=False)
        rows.append({
            "uid": uid,
            "project_id": pid,
            "project_name": t.get("project_name") or project_row["name"],
            "project_short": t.get("project_short") or project_row["short"],
            "task_id": t.get("task_id"),
            "unique_id": t.get("unique_id"),
            "outline": str(t.get("outline")) if t.get("outline") is not None else None,
            "outline_level": t.get("outline_level"),
            "parent_uid": infer_parent_uid(pid, t.get("outline"), by_outline),
            "sort_order": idx,
            "wbs": t.get("wbs") or t.get("outline"),
            "name": t.get("name") or "Sin nombre",
            "is_summary": bool(t.get("is_summary")),
            "is_milestone": bool(t.get("is_milestone")),
            "start_at": iso_or_none(t.get("start")),
            "finish_at": iso_or_none(t.get("finish")),
            "duration_text": t.get("duration_text"),
            "duration_days": t.get("duration_days"),
            "percent_complete": t.get("percent_complete"),
            "resource_names": t.get("resource_names"),
            "responsible": t.get("responsible") or t.get("resource_names"),
            "critical": bool(t.get("critical")),
            "total_slack": t.get("total_slack"),
            "deadline": iso_or_none(t.get("deadline")),
            "notes": t.get("notes"),
            "predecessors": t.get("predecessors") or [],
            "predecessor_text": t.get("predecessor_text"),
            "raw": t,
            "hidden": False,
            "last_import_id": import_id,
            "source_hash": hashlib.sha256(row_raw.encode("utf-8")).hexdigest(),
        })

    for part in chunks(rows):
        request("POST", "tasks?on_conflict=uid", part, prefer="resolution=merge-duplicates,return=minimal")

    if import_id:
        summaries = sum(1 for t in tasks if t.get("is_summary"))
        milestones = sum(1 for t in tasks if t.get("is_milestone"))
        request("PATCH", f"mpp_imports?id=eq.{import_id}", {
            "status":"processed",
            "message":"Procesado correctamente desde GitHub Actions.",
            "total_tasks": len(tasks),
            "total_summaries": summaries,
            "total_milestones": milestones,
            "processed_at": now,
        }, prefer="return=minimal")

print("Supabase actualizado correctamente")
