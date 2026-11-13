import json
import urllib.parse
import urllib.request
import urllib.error

KEY = "sb_publishable_ecd68T10S_gRouDU5q0EwA_ZW0gp3Oy"
BASE = "https://yvnqvdyhrmrzxdwhnydc.supabase.co/rest/v1/"


def get(path, extra_headers=None):
    headers = {"apikey": KEY, "Authorization": "Bearer " + KEY}
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(BASE + path, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")
    except Exception as e:
        return "ERR", repr(e)


# 1) подсказка PostgREST о похожих колонках
for t in ("profiles", "subscriptions"):
    print(t, get(t + "?select=zzz_nonexistent")[1][:400])

# 2) кандидаты колонок: проверяем по одной
candidates = [
    "id", "user_id", "email", "full_name", "name", "avatar_url", "plan", "plan_id",
    "status", "tokens", "tokens_left", "tokens_used", "token_limit", "token_balance",
    "current_period_end", "period_end", "expires_at", "renews_at", "started_at",
    "created_at", "updated_at", "active", "interval", "price", "auto_renew", "provider",
]
for t in ("profiles", "subscriptions"):
    ok = []
    for c in candidates:
        status, _ = get(t + "?select=" + c + "&limit=0")
        if status == 200:
            ok.append(c)
    print("\n", t, "колонки:", ok)
