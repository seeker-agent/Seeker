import json
import urllib.request

KEY = "sb_publishable_ecd68T10S_gRouDU5q0EwA_ZW0gp3Oy"
ROOT = "https://yvnqvdyhrmrzxdwhnydc.supabase.co/rest/v1/"

req = urllib.request.Request(ROOT, headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
with urllib.request.urlopen(req, timeout=25) as resp:
    spec = json.loads(resp.read().decode("utf-8"))

defs = spec.get("definitions", {})
print("TABLES:", sorted(defs.keys()))
for table in ("profiles", "subscriptions"):
    d = defs.get(table)
    if not d:
        print(table, "=> нет в схеме")
        continue
    print("\n==", table, "==")
    print("required:", d.get("required"))
    for col, meta in (d.get("properties") or {}).items():
        if isinstance(meta, dict) and "format" in meta:
            continue  # служебные колонки PostgREST
        print("  ", col, "|", meta.get("type"), meta.get("format") or "", "| default:", meta.get("default"))
