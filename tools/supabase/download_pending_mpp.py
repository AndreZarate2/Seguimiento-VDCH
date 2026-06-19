#!/usr/bin/env python3
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
BUCKET = os.environ.get("SUPABASE_MPP_BUCKET", "mpp-files")
IMPORT_ID = os.environ.get("IMPORT_ID", "").strip()
PROJECT_SLUG = os.environ.get("PROJECT_SLUG", "").strip()

if not SUPABASE_URL or not SERVICE_KEY:
    print("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
    sys.exit(2)

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
}


def rest_get(path):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=HEADERS, timeout=60)
    if not r.ok:
        raise RuntimeError(f"GET {path} -> {r.status_code}: {r.text}")
    return r.json()


def rest_patch(path, payload):
    h = dict(HEADERS)
    h["Prefer"] = "return=representation"
    r = requests.patch(f"{SUPABASE_URL}/rest/v1/{path}", headers=h, data=json.dumps(payload), timeout=60)
    if not r.ok:
        raise RuntimeError(f"PATCH {path} -> {r.status_code}: {r.text}")
    return r.json()


def canonical_path(slug):
    if slug == "conexion-vdch":
        return Path("uploads/mpp/cronograma-conexion-vdch.mpp")
    if slug == "alimentador-sullana":
        return Path("uploads/mpp/cronograma-alimentador-sullana.mpp")
    return Path("uploads/mpp") / f"{slug}.mpp"

query = "mpp_imports?select=*&order=created_at.desc&limit=1"
if IMPORT_ID:
    query = f"mpp_imports?select=*&id=eq.{IMPORT_ID}"
elif PROJECT_SLUG:
    query = f"mpp_imports?select=*&project_slug=eq.{PROJECT_SLUG}&status=eq.pending&order=created_at.desc&limit=1"
else:
    query = "mpp_imports?select=*&status=eq.pending&order=created_at.asc&limit=1"

imports = rest_get(query)
if not imports:
    print("No hay importaciones pendientes para procesar.")
    Path("tools/supabase/selected_imports.json").write_text("[]", encoding="utf-8")
    sys.exit(0)

selected = []
for item in imports:
    slug = item["project_slug"]
    file_path = item["file_path"]
    import_id = item["id"]
    rest_patch(f"mpp_imports?id=eq.{import_id}", {"status":"processing", "started_at":datetime.now(timezone.utc).isoformat(), "message":"Procesando desde GitHub Actions."})

    encoded_path = "/".join(quote(part) for part in file_path.split("/"))
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{encoded_path}"
    r = requests.get(url, headers={"Authorization": f"Bearer {SERVICE_KEY}", "apikey": SERVICE_KEY}, timeout=120)
    if not r.ok:
        rest_patch(f"mpp_imports?id=eq.{import_id}", {"status":"error", "message":f"No se pudo descargar Storage: {r.status_code} {r.text[:200]}"})
        raise RuntimeError(f"No se pudo descargar {file_path}: {r.status_code} {r.text}")

    out = canonical_path(slug)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(r.content)
    selected.append({"id": import_id, "project_slug": slug, "file_path": file_path, "local_path": str(out)})
    print(f"Descargado {file_path} -> {out}")

Path("tools/supabase/selected_imports.json").write_text(json.dumps(selected, indent=2), encoding="utf-8")
