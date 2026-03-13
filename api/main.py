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
import os
import pathlib
import re
import threading
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
INDEX_OCR_PATH = ROOT / "data" / "index_ocr.faiss"
STORE_OCR_PATH = ROOT / "data" / "metadata_store_ocr.json"
OCR_STORE_PATH = ROOT / "data" / "ocr_store.json"
IMAGES_PATH = ROOT / "data" / "MenuCardsDataset"

# In Docker, Ollama runs as a sidecar container named "ollama".
# Locally it's on localhost. Override via OLLAMA_HOST env var.
_ollama_host = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_URL = f"{_ollama_host}/api/generate"
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2")
MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"

# USE_LOCAL_IMAGES=true  → serve from local MenuCardsDataset/ (dev / if data volume mounted)
# USE_LOCAL_IMAGES=false → proxy to SBB IIIF server (recommended for deployment)
USE_LOCAL_IMAGES = os.environ.get("USE_LOCAL_IMAGES", "true").lower() == "true"

# ── Startup: load index + metadata ────────────────────────────────────────────
print("Loading FAISS index (v1) …")
index = faiss.read_index(str(INDEX_PATH))

print("Loading metadata store (v1) …")
with open(STORE_PATH, encoding="utf-8") as f:
    metadata_store: list[dict] = json.load(f)

# OCR-only index — loaded if available; enables "ocr" and "both" search modes
if INDEX_OCR_PATH.exists() and STORE_OCR_PATH.exists():
    print("Loading FAISS index (OCR-only) …")
    index_ocr = faiss.read_index(str(INDEX_OCR_PATH))
    with open(STORE_OCR_PATH, encoding="utf-8") as f:
        metadata_store_ocr: list[dict] = json.load(f)
    print(f"OCR index ready — {len(metadata_store_ocr)} records")
else:
    index_ocr = None
    metadata_store_ocr = []
    print(
        "OCR index not found — run build_index_v2.py to enable 'ocr' and 'both' modes"
    )

# OCR text store — {ppn: ocr_text}; used to enrich Archivist context
if OCR_STORE_PATH.exists():
    with open(OCR_STORE_PATH, encoding="utf-8") as f:
        ocr_lookup: dict[str, str] = json.load(f)
    print(f"OCR text store ready — {len(ocr_lookup)} records")
else:
    ocr_lookup = {}
    print("OCR text store not found — Archivist will use metadata only")

print("Loading embedding model …")
model = SentenceTransformer(MODEL_NAME)

print(f"Ready — {len(metadata_store)} records, index size {index.ntotal}")


# Warm up Ollama in the background so the first real request doesn't cold-start
def _warmup_ollama():
    import time

    for _ in range(18):  # wait up to 90s for Ollama to come up
        try:
            httpx.get(f"{_ollama_host}/api/tags", timeout=5.0)
            break
        except Exception:
            time.sleep(5)
    try:
        httpx.post(
            OLLAMA_URL,
            json={"model": OLLAMA_MODEL, "prompt": "hi", "stream": False},
            timeout=120.0,
        )
        print("Ollama warm-up complete")
    except Exception as exc:
        print(f"Ollama warm-up skipped: {exc}")


threading.Thread(target=_warmup_ollama, daemon=True).start()


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
    search_mode: str = "meta"  # "meta" | "ocr" | "both"
    meta_weight: float = (
        0.5  # 0–1; only used when search_mode="both". 0 = all OCR, 1 = all metadata
    )


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
    messages: list[ChatMessage] = []


class ParseRequest(BaseModel):
    query: str


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

    # Normalise mode: fall back gracefully if OCR index isn't built yet
    mode = req.search_mode
    if mode in ("ocr", "both") and index_ocr is None:
        mode = "meta"  # silent fallback

    def _make_item(r: dict, score: float) -> dict:
        item = r.copy()
        item["score"] = score
        item["local_image_url"] = (
            f"/images/{item['ppn']}/00000001.jpg"
            if USE_LOCAL_IMAGES
            else item["iiif_image_url"]
        )
        item.setdefault(
            "iiif_manifest_url",
            f"https://content.staatsbibliothek-berlin.de/dc/{item['ppn']}/manifest",
        )
        if item["ppn"] in ocr_lookup:
            item["ocr_text"] = ocr_lookup[item["ppn"]]
        return item

    def _faiss_scores(idx, store) -> dict[str, float]:
        """Query an index, return {ppn: score} for every result."""
        vec = model.encode(
            [req.query],
            normalize_embeddings=True,
            convert_to_numpy=True,
        ).astype(np.float32)
        scores, indices = idx.search(vec, idx.ntotal)
        return {
            store[i]["ppn"]: float(s) for s, i in zip(scores[0], indices[0]) if i >= 0
        }

    # ── Facet-only path (no query) ────────────────────────────────────────────
    if not has_query:
        results = [_make_item(r, 0.0) for r in metadata_store]

    # ── Semantic search path ──────────────────────────────────────────────────
    elif mode == "meta":
        scores_map = _faiss_scores(index, metadata_store)
        ppn_to_meta = {r["ppn"]: r for r in metadata_store}
        results = [
            _make_item(ppn_to_meta[ppn], score)
            for ppn, score in sorted(scores_map.items(), key=lambda x: -x[1])
            if ppn in ppn_to_meta
        ]

    elif mode == "ocr":
        scores_map = _faiss_scores(index_ocr, metadata_store_ocr)
        ppn_to_meta = {r["ppn"]: r for r in metadata_store}
        results = [
            _make_item(ppn_to_meta[ppn], score)
            for ppn, score in sorted(scores_map.items(), key=lambda x: -x[1])
            if ppn in ppn_to_meta
        ]

    else:  # "both" — weighted blend: α·meta + (1-α)·ocr
        meta_scores = _faiss_scores(index, metadata_store)
        ocr_scores = _faiss_scores(index_ocr, metadata_store_ocr)
        ppn_to_meta = {r["ppn"]: r for r in metadata_store}
        all_ppns = set(meta_scores) | set(ocr_scores)
        w = max(0.0, min(1.0, req.meta_weight))  # clamp to [0, 1]
        fused = {
            ppn: w * meta_scores.get(ppn, 0.0) + (1.0 - w) * ocr_scores.get(ppn, 0.0)
            for ppn in all_ppns
        }
        results = [
            _make_item(ppn_to_meta[ppn], score)
            for ppn, score in sorted(fused.items(), key=lambda x: -x[1])
            if ppn in ppn_to_meta
        ]
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

    return {"results": results, "total_candidates": len(results), "search_mode": mode}


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
        if r.get("ocr_text"):
            # Truncate to keep prompt size reasonable; ~600 chars ≈ ~150 tokens
            snippet = r["ocr_text"][:600].strip()
            lines.append(f"  Menu text:   {snippet}")
        context_lines.append("\n".join(lines))

    context = "\n\n".join(context_lines)

    prompt = (
        "You are a knowledgeable archivist helping researchers explore a collection "
        "of historical menu cards from the Staatsbibliothek zu Berlin (SBB), "
        "mostly dating from 1880–1913, though the collection spans 1700–1920.\n\n"
        "Each catalogue record has up to five labelled fields:\n"
        "  Title       — the short title of the card\n"
        "  Date        — year or date range\n"
        "  Place       — the city, ship company, hotel, or institution that issued the card\n"
        "  Description — a librarian's PHYSICAL description of the card object (paper, printing, size, condition). "
        "It does NOT contain a transcription of the menu text itself.\n"
        "  Menu text   — OCR-extracted text from the card image (may contain OCR errors). "
        "This is the actual printed menu content — dishes, courses, prices etc.\n\n"
        "CRITICAL: The Description field describes the physical card, not the food on the menu. "
        "Only the Menu text field contains actual food content. "
        "Do NOT invent or guess dishes that are not explicitly present in the fields above.\n\n"
        'A researcher has asked: "{query}"\n\n'
        "You are viewing page {page} of {total_pages} of the search results "
        "({start_index}–{end_index} of {total_results} matching records).\n\n"
        "Based on these catalogue records from the collection:\n\n"
        "{context}\n\n"
        "Instructions:\n"
        "- Begin with 2–3 sentences that directly address the researcher's query: summarise what kinds of records were found, what themes or patterns connect them to what was asked, and any noteworthy highlights.\n"
        "- Then cover each record individually. For each: state the date, place/occasion, and describe the food visible in the Menu text field. Translate or interpret French/German dish names where helpful. Reference cards by number [1], [2] etc.\n"
        "- Treat every card as a distinct item — do not say one card 'repeats' or 'is the same as' another, even if they look similar.\n"
        "- These records were retrieved by semantic similarity — they are all relevant. Do NOT comment on whether the query terms appear literally in the text. Do NOT use any phrase about absence, missing content, or failed matches.\n"
        "- Only describe what is written in the fields. Do NOT invent dish names or details not present in the record.\n"
        "- If the Menu text field is garbled OCR, briefly note it is illegible rather than quoting the noise.\n"
        "- If no Menu text field is present for a card, note briefly that OCR was not available.\n"
        "- Cover all the records shown.\n"
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
        async with httpx.AsyncClient(timeout=180.0) as client:
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

    # Build a system prompt grounded in this card's metadata + OCR text
    field_lines = []
    for label, key in [
        ("Title", "subtitle"),
        ("Date", "date"),
        ("Place", "place"),
        ("Description", "description"),
    ]:
        if card.get(key):
            field_lines.append(f"  {label}: {card[key]}")
    ocr_raw = ocr_lookup.get(req.ppn, "")
    if ocr_raw:
        field_lines.append(
            f"  Menu text (OCR, may contain errors): {ocr_raw[:1200].strip()}"
        )
    card_context = "\n".join(field_lines)

    system = (
        "You are a knowledgeable archivist at the Staatsbibliothek zu Berlin. "
        "A researcher is viewing a single historical menu card from the collection. "
        "Answer their questions using the information in the catalogue record below. "
        "The 'Menu text' field is raw OCR output from the card image and will contain errors — "
        "report only words you are confident are correct; do not guess at garbled text. "
        "Be concise and factual. Do not use informal language, humour, or filler phrases. "
        "If a question cannot be answered from the record, say so briefly.\n\n"
        f"Catalogue record:\n{card_context}"
    )

    messages = [{"role": "system", "content": system}] + [
        {"role": m.role, "content": m.content} for m in req.messages
    ]

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            response = await client.post(
                f"{_ollama_host}/api/chat",
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


@app.post("/parse")
async def parse_query(req: ParseRequest):
    """
    Query decomposition: rewrites the query into a clean semantic search string
    and optionally adds a caveat. Does NOT extract place/year — those are
    user-controlled facet filters only.
    """
    prompt = (
        "You rewrite natural language queries into clean semantic search strings for a catalogue "
        "of 2,403 historical menu cards (Staatsbibliothek zu Berlin, mostly 1880–1913).\n\n"
        "Remove boilerplate phrases like 'show me menus', 'find menus with', 'I want to see', "
        "'search for' — keep only the meaningful content words.\n\n"
        "Respond with JSON only. No markdown, no explanation.\n\n"
        "If the query is asking for specific dish names or food content (not titles/occasions), "
        "add a caveat suggesting the user enable OCR mode.\n\n"
        "Examples:\n"
        'Input: "show me menus with ships and boats"\n'
        'Output: {"semantic_query": "ships and boats", "caveat": null}\n\n'
        'Input: "elegant dinner on a ship"\n'
        'Output: {"semantic_query": "elegant dinner ship", "caveat": null}\n\n'
        'Input: "French dinner on a boat with seabass"\n'
        'Output: {"semantic_query": "French dinner boat seabass", "caveat": null}\n\n'
        'Input: "find me vegetarian dishes on the menu"\n'
        'Output: {"semantic_query": "vegetarian", "caveat": "Tip: switch the search index to OCR or Both in Advanced settings — OCR text from card images may contain dish names."}\n\n'
        'Input: "menus with Polish food in Berlin in the 1890s"\n'
        'Output: {"semantic_query": "Polish food Berlin 1890s", "caveat": "Tip: switch the search index to OCR or Both in Advanced settings — OCR text from card images may contain dish and cuisine names."}\n\n'
        'Input: "Hohenzollern yacht imperial dinner"\n'
        'Output: {"semantic_query": "Hohenzollern yacht imperial dinner", "caveat": null}\n\n'
        f'Input: "{req.query}"\n'
        "Output:"
    )

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                OLLAMA_URL,
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0},
                },
            )
            response.raise_for_status()
            raw = response.json()["response"].strip()

        # Strip markdown fences if the model wraps them anyway
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        parsed = json.loads(raw)
        return {
            "semantic_query": parsed.get("semantic_query") or req.query,
            "place": None,
            "year_from": None,
            "year_to": None,
            "caveat": parsed.get("caveat") or None,
        }

    except (json.JSONDecodeError, KeyError):
        # If parsing fails fall back to the raw query unchanged
        return {
            "semantic_query": req.query,
            "place": None,
            "year_from": None,
            "year_to": None,
            "caveat": None,
        }
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Ollama is not running. Start it with: ollama serve",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
