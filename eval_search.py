import json
import urllib.request

API = "http://localhost:8000"


def search(query, place=None, year_from=None, year_to=None, top=5):
    body = {"query": query}
    if place:
        body["place"] = place
    if year_from:
        body["year_from"] = year_from
    if year_to:
        body["year_to"] = year_to
    req = urllib.request.Request(
        f"{API}/search",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        data = json.loads(r.read())
    results = data["results"][:top]
    print(f"\n{'='*65}")
    print(f"QUERY: {query!r}")
    if place:
        print(f"  + place filter: {place!r}")
    print(f"  Top {top} of {data['total_candidates']} results:")
    for i, r in enumerate(results, 1):
        score = r["score"] * 100
        subtitle = (r.get("subtitle") or "")[:35]
        place_val = (r.get("place") or "")[:28]
        date_val = (r.get("date") or "?")[:6]
        print(f"  [{i}] {score:4.0f}% | {date_val:>6} | {place_val:<28} | {subtitle}")


# --- Test queries ---

# Should be strong: ships are in the Place field for several cards
search("elegant dinner on a ship")

# Should be decent: Weihnachten may appear in descriptions
search("Christmas dinner menu")

# Weddings — Hochzeit/Jubiläum may appear
search("wedding banquet celebration")

# Known bad: food content not in metadata
search("menus with Polish food")

# Named entity — Hohenzollern yacht is a known Place value
search("Hohenzollern yacht imperial dinner")

# Probably no real matches — vegetarian not a concept in this era's cataloguing
search("vegetarian menu")

# Hotel in Berlin — good structured query
search("dinner Berlin hotel 1900", year_from=1895, year_to=1905)

# German query — model is multilingual so should work
search("Speisekarte Dampfer Hamburg")

# Score distribution check — what's the worst score in top 12?
print(f"\n{'='*65}")
print("SCORE SPREAD: 'menus with Polish food' — all 2403 results")
body = {"query": "menus with Polish food"}
req = urllib.request.Request(
    f"{API}/search",
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req) as r:
    data = json.loads(r.read())
scores = [r["score"] * 100 for r in data["results"]]
print(
    f"  Max: {max(scores):.1f}%  Min: {min(scores):.1f}%  "
    f"Top12 range: {scores[0]:.1f}–{scores[11]:.1f}%  "
    f"p50: {sorted(scores)[len(scores)//2]:.1f}%"
)
