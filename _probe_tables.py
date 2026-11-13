import json
import urllib.request
import urllib.error

KEY = "sb_publishable_ecd68T10S_gRouDU5q0EwA_ZW0gp3Oy"
BASE = "https://yvnqvdyhrmrzxdwhnydc.supabase.co/rest/v1/"

TABLES = [
    "profiles", "subscriptions", "token_balances", "tokens", "plans",
    "orders", "payments", "token_usage", "usage", "user_tokens", "balances",
]

for table in TABLES:
    url = BASE + table + "?select=*&limit=1"
    req = urllib.request.Request(url, headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8")
            print(table, "=>", resp.status, body[:200])
    except urllib.error.HTTPError as e:
        print(table, "=>", e.code, e.read().decode("utf-8")[:200])
    except Exception as e:
        print(table, "=> ERR", repr(e))
