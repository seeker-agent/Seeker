import urllib.request
import urllib.error

KEY = "sb_publishable_ecd68T10S_gRouDU5q0EwA_ZW0gp3Oy"
BASE = "https://yvnqvdyhrmrzxdwhnydc.supabase.co/rest/v1/"


def get(path):
    req = urllib.request.Request(BASE + path, headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return "ERR", repr(e)


TABLES = [
    "subscription", "user_subscriptions", "seeker_subscriptions", "limits", "token_limits",
    "devices", "projects", "sessions", "invoices", "transactions",
]
for t in TABLES:
    code, body = get(t + "?select=*&limit=1")
    print("TABLE", t, "=>", code, body[:160].replace("\n", " "))

COLS = {
    "profiles": [
        "full_name", "name", "display_name", "avatar_url", "plan", "subscription_status",
        "tokens", "tokens_left", "tokens_limit", "token_balance", "is_pro", "pro", "provider",
    ],
    "subscriptions": [
        "id", "created_at", "current_period_end", "cancel_at_period_end", "interval",
        "price", "amount", "currency", "external_id", "subscription_id", "tokens",
        "tokens_limit", "is_active", "active", "email",
    ],
}
for t, cands in COLS.items():
    ok = []
    for c in cands:
        code, _ = get(t + "?select=" + c + "&limit=0")
        if code == 200:
            ok.append(c)
    print("\nCOLS", t, "=>", ok)
