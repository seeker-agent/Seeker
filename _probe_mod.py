import urllib.request, urllib.error

KEY = "sb_publishable_ecd68T10S_gRouDU5q0EwA_ZW0gp3Oy"
BASE = "https://yvnqvdyhrmrzxdwhnydc.supabase.co/rest/v1/"

for table in ["profiles", "subscriptions", "refund_requests", "user_roles", "payment_events", "refund_events"]:
    req = urllib.request.Request(
        BASE + table + "?select=*&limit=1",
        headers={"apikey": KEY, "Authorization": "Bearer " + KEY},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            print(table, "=>", r.status, r.read().decode()[:150])
    except urllib.error.HTTPError as e:
        print(table, "=>", e.code, e.read().decode()[:150])
    except Exception as e:
        print(table, "=> ERR", repr(e))
