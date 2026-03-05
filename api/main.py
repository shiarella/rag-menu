"""
api/main.py — FastAPI backend for the menu card RAG search

Endpoints:
  GET  /facets         — unique places + year range for UI filter controls
  POST /search         — semantic search + optional metadata post-filter
  POST /generate       — RAG: build context from results, call Ollama, return answer

Run:
  .venv/bin/uvicorn api.main:app --reload --port 8000
"""

import json
import pathlib
import re
from typing import Optional

import faiss
import httpx
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

# ── Paths ──────────────────────────────────────────────────────────────────────
ROOT = pathlib.Path(__file__).parent.parent
INDEX_PATH = ROOT / "data" / "index.faiss"
STORE_PATH = ROOT / "data" / "metadata_store.json"
IMAGES_PATH = ROOT / "data" / "MenuCardsDataset"

OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3.2"
MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"

# Minimum cosine similarity to include a result (0–1 scale)
# Below this the card is likely noise, not a real match.
# No server-side score threshold — the frontend lets users filter by relevance themselves.

# Set to True to serve images from the local MenuCardsDataset folder (fast, no network).
# Set to False to use IIIF URLs from the SBB server (no local data needed — good for deployment).
USE_LOCAL_IMAGES = True

# ── Startup: load index + metadata ────────────────────────────────────────────
print("Loading FAISS index …")
index = faiss.read_index(str(INDEX_PATH))

print("Loading metadata store …")
with open(STORE_PATH, encoding="utf-8") as f:
    metadata_store: list[dict] = json.load(f)

print("Loading embedding model …")
model = SentenceTransformer(MODEL_NAME)

print(f"Ready — {len(metadata_store)} records, index size {index.ntotal}")


# ── Facet pre-computation ─────────────────────────────────────────────────────
def _extract_year(date_str: str) -> Optional[int]:
    m = re.search(r"\b(\d{4})\b", date_str)
    return int(m.group(1)) if m else None


_all_places = sorted({r["place"] for r in metadata_store if r.get("place", "").strip()})
_all_years = [y for r in metadata_store if (y := _extract_year(r.get("date", "")))]
_year_min = min(_all_years) if _all_years else 1700
_year_max = max(_all_years) if _all_years else 1950

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="Menu Card RAG API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve local card images at /images/{PPN}/00000001.jpg
if IMAGES_PATH.exists():
    app.mount("/images", StaticFiles(directory=str(IMAGES_PATH)), name="images")


# ── Models ─────────────────────────────────────────────────────────────────────
class SearchRequest(BaseModel):
    query: str
    top_k: int = 5
    place: Optional[str] = None  # substring match, case-insensitive
    year_from: Optional[int] = None  # inclusive
    year_to: Optional[int] = None  # inclusive


class GenerateRequest(BaseModel):
    query: str
    results: list[dict]  # pass the /search results directly
    start_index: int = (
        1  # global card number of the first result (for correct [N] references)
    )
    page: int = 1
    total_pages: int = 1
    total_results: int = 0


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    ppn: str
    messages: list[ChatMessage]


# ── Routes ─────────────────────────────────────────────────────────────────────
@app.get("/facets")
def get_facets():
    """Return all unique places and year range for populating UI filters."""
    return {
        "places": _all_places,
        "year_min": _year_min,
        "year_max": _year_max,
    }


@app.get("/card/{ppn}")
def get_card(ppn: str):
    """Return the full metadata record for a single card by PPN."""
    for r in metadata_store:
        if r["ppn"] == ppn:
            item = r.copy()
            item["local_image_url"] = (
                f"/images/{ppn}/00000001.jpg"
                if USE_LOCAL_IMAGES
                else r["iiif_image_url"]
            )
            item.setdefault(
                "iiif_manifest_url",
                f"https://content.staatsbibliothek-berlin.de/dc/{ppn}/manifest",
            )
            return item
    raise HTTPException(status_code=404, detail=f"Card {ppn!r} not found")


@app.post("/search")
def search(req: SearchRequest):
    """
    Semantic search + optional metadata post-filter.

    Strategy:
    - If query is blank but filters are set: skip FAISS, scan metadata directly
      and return all matching records ordered by date (facet-only browse mode).
    - Otherwise: embed the query, retrieve candidates from FAISS, then filter.
    """
    has_query = bool(req.query.strip())
    has_filter = bool(req.place or req.year_from or req.year_to)

    if not has_query and not has_filter:
        raise HTTPException(
            status_code=400, detail="Provide a search query or at least one filter."
        )

    def _make_item(r: dict, score: float) -> dict:
        item = r.copy()
        item["score"] = score
        item["local_image_url"] = (
            f"/images/{item['ppn']}/00000001.jpg"
            if USE_LOCAL_IMAGES
            else item["iiif_image_url"]
        )
        # Always include the manifest URL so the detail page can open the IIIF viewer
        item.setdefault(
            "iiif_manifest_url",
            f"https://content.staatsbibliothek-berlin.de/dc/{item['ppn']}/manifest",
        )
        return item

    # ── Facet-only path (no query) ────────────────────────────────────────────
    if not has_query:
        results = [_make_item(r, 0.0) for r in metadata_store]

    # ── Semantic search path ──────────────────────────────────────────────────
    else:
        # 1. Embed query
        vec = model.encode(
            [req.query],
            normalize_embeddings=True,
            convert_to_numpy=True,
        ).astype(np.float32)

        # 2. FAISS: search all records — with 2,403 vectors this is instant.
        # The frontend handles relevance filtering, so we return the full ranking.
        scores, indices = index.search(vec, index.ntotal)

        # 3. Build result list with metadata
        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0:
                continue
            results.append(_make_item(metadata_store[idx], float(score)))

    # ── Apply filters (both paths) ────────────────────────────────────────────
    if req.place:
        needle = req.place.lower()
        results = [r for r in results if needle in r.get("place", "").lower()]

    if req.year_from is not None or req.year_to is not None:
        filtered = []
        for r in results:
            year = _extract_year(r.get("date", ""))
            if year is None:
                continue
            if req.year_from is not None and year < req.year_from:
                continue
            if req.year_to is not None and year > req.year_to:
                continue
            filtered.append(r)
        results = filtered

    # In facet-only mode, sort by date descending (newest first) for a sensible default.
    if not has_query:
        results.sort(key=lambda r: _extract_year(r.get("date", "")) or 0, reverse=True)

    return {"results": results, "total_candidates": len(results)}


@app.post("/generate")
async def generate(req: GenerateRequest):
    """
    RAG generation: build a context block from search results and ask Ollama.
    """
    if not req.results:
        raise HTTPException(status_code=400, detail="results list is empty")

    # Build context block with explicit field labels so the LLM cannot
    # mistake the Place/issuer field for part of the description.
    context_lines = []
    for i, r in enumerate(req.results, req.start_index):
        lines = [f"[{i}]"]
        if r.get("subtitle"):
            lines.append(f"  Title:       {r['subtitle']}")
        if r.get("date"):
            lines.append(f"  Date:        {r['date']}")
        if r.get("place"):
            lines.append(f"  Place:       {r['place']}")
        if r.get("description"):
            lines.append(f"  Description: {r['description']}")
        context_lines.append("\n".join(lines))

    context = "\n\n".join(context_lines)

    prompt = (
        "You are a knowledgeable archivist helping researchers explore a collection "
        "of historical menu cards from the Staatsbibliothek zu Berlin (SBB), "
        "mostly dating from 1880–1913, though the collection spans 1700–1920.\n\n"
        "Each catalogue record has four labelled fields:\n"
        "  Title       — the short title of the card\n"
        "  Date        — year or date range\n"
        "  Place       — the city, ship company, hotel, or institution that issued the card\n"
        "  Description — a librarian's PHYSICAL description of the card object (paper, printing, size, condition). "
        "It does NOT contain a transcription of the menu text itself.\n\n"
        "CRITICAL: The Description field describes the physical card, not the food on the menu. "
        "Do NOT invent, infer, or guess specific dishes, ingredients, or cuisines that are not explicitly stated in the fields above. "
        "Only report what is literally written in the catalogue record.\n\n"
        'A researcher has asked: "{query}"\n\n'
        "You are viewing page {page} of {total_pages} of the search results "
        "({start_index}–{end_index} of {total_results} matching records).\n\n"
        "Based on these catalogue records from the collection:\n\n"
        "{context}\n\n"
        "Instructions:\n"
        "- Provide a helpful, concise answer in English.\n"
        "- Reference specific cards by their number [1], [2] etc. where relevant.\n"
        "- Treat every card as a distinct item — do not say one card 'repeats' or 'is the same as' another, even if they look similar.\n"
        "- Only describe what is explicitly written in the catalogue fields. Do NOT invent dish names, ingredients, or cuisine types that are not literally present in the record.\n"
        "- If a query asks about specific food content (e.g. dishes on the menu) that is not in the Description field, say that the catalogue records describe the physical cards only and do not transcribe the menu text.\n"
        "- If the researcher asks about a location, check the Place field of every record carefully.\n"
        "- These records were selected and ranked by semantic similarity — trust the ranking. Do not say a record 'does not match'; instead describe what it contains and how it relates to the query.\n"
        "- Cover all the records shown, not just a few you judge to be strong matches.\n"
        "- Do NOT apply any date range filter of your own — report the dates as they appear in the records.\n"
        "- Do NOT suggest external archives, other collections, or resources outside this catalogue.\n"
        "- Do NOT refer to cards from previous pages that are not in the context above.\n"
        "- Do not end with a summary sentence dismissing the remaining records."
    ).format(
        query=req.query,
        context=context,
        page=req.page,
        total_pages=req.total_pages,
        start_index=req.start_index,
        end_index=req.start_index + len(req.results) - 1,
        total_results=req.total_results,
    )

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                OLLAMA_URL,
                json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
            )
            response.raise_for_status()
            answer = response.json()["response"]
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Ollama is not running. Start it with: ollama serve",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"answer": answer, "prompt_length": len(prompt)}


@app.post("/chat")
async def chat(req: ChatRequest):
    """
    Multi-turn chat about a single card. The full conversation history is sent
    each turn so the model has context. Uses Ollama's /api/chat endpoint.
    """
    # Look up the card
    card = next((r for r in metadata_store if r["ppn"] == req.ppn), None)
    if not card:
        raise HTTPException(status_code=404, detail=f"Card {req.ppn!r} not found")

    # Build a system prompt grounded in this card's metadata only
    field_lines = []
    for label, key in [
        ("Title", "subtitle"),
        ("Date", "date"),
        ("Place", "place"),
        ("Description", "description"),
    ]:
        if card.get(key):
            field_lines.append(f"  {label}: {card[key]}")
    card_context = "\n".join(field_lines)

    system = (
        "You are a knowledgeable archivist at the Staatsbibliothek zu Berlin. "
        "A researcher is viewing a single historical menu card from the collection. "
        "Answer their questions using only the information in the catalogue record below. "
        "Be concise, helpful, and stay in the role of an archivist. "
        "If a question cannot be answered from the record, say so briefly.\n\n"
        f"Catalogue record:\n{card_context}"
    )

    messages = [{"role": "system", "content": system}] + [
        {"role": m.role, "content": m.content} for m in req.messages
    ]

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "http://localhost:11434/api/chat",
                json={"model": OLLAMA_MODEL, "messages": messages, "stream": False},
            )
            response.raise_for_status()
            reply = response.json()["message"]["content"]
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Ollama is not running. Start it with: ollama serve",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"reply": reply}
