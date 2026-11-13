import json
import urllib.request
import urllib.error

KEY = "sb_publishable_ecd68T10S_gRouDU5q0EwA_ZW0gp3Oy"
BASE = "https://yvnqvdyhrmrzxdwhnydc.supabase.co"

TABLES = [
    "profiles", "subscriptions", "plans", "orders", "payments",
    "token_balances", "tokens", "token_usage", "usage", "user_tokens", "balances",
]


def get(path):
    req = urllib.request.Request(BASE + path, headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return "ERR", repr(e)


print("AUTH HEALTH:", get("/auth/v1/health"))
print()
for t in TABLES:
    code, body = get("/rest/v1/%s?select=*&limit=1" % t)
    print(t, "=>", code, body[:300].replace("\n", " "))
