import json, urllib.request

API = "http://localhost:8000"
queries = [
    "show me menus with ships and boats and cowz",
    "elegant dinner on a ship",
    "Hohenzollern yacht imperial dinner",
    "find me vegetarian dishes on the menu",
    "fancy Berlin hotel dinner in the 1890s",
    "xcxcvxcv",
    "menus with Polish food",
    "I want to see wedding menus from Hamburg around 1900",
]

for q in queries:
    req = urllib.request.Request(
        f"{API}/parse",
        data=json.dumps({"query": q}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        d = json.loads(r.read())
    caveat = "YES" if d.get("caveat") else "no"
    place = d.get("place") or "—"
    yf, yt = d.get("year_from") or "—", d.get("year_to") or "—"
    sq = d.get("semantic_query", "")
    print(f"IN:  {q}")
    print(f"OUT: {sq!r}  | place={place}  years={yf}–{yt}  caveat={caveat}")
    print()
