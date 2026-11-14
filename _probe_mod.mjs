const KEY = "sb_publishable_ecd68T10S_gRouDU5q0EwA_ZW0gp3Oy";
const BASE = "https://yvnqvdyhrmrzxdwhnydc.supabase.co/rest/v1/";
const tables = ["profiles", "subscriptions", "refund_requests", "user_roles", "payment_events", "refund_events"];

for (const t of tables) {
  try {
    const r = await fetch(BASE + t + "?select=*&limit=1", {
      headers: { apikey: KEY, Authorization: "Bearer " + KEY },
    });
    const body = await r.text();
    console.log(t, "=>", r.status, body.slice(0, 160));
  } catch (e) {
    console.log(t, "=> ERR", String(e));
  }
}
