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
MIN_SCORE = 0.30

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
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
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


# ── Routes ─────────────────────────────────────────────────────────────────────
@app.get("/facets")
def get_facets():
    """Return all unique places and year range for populating UI filters."""
    return {
        "places": _all_places,
        "year_min": _year_min,
        "year_max": _year_max,
    }


@app.post("/search")
def search(req: SearchRequest):
    """
    Semantic search + optional metadata post-filter.

    Strategy:
    - Embed the query and retrieve top 50 candidates from FAISS
    - Apply hard filters (place substring match, year range)
    - Return top_k results after filtering
    """
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="query must not be empty")

    # 1. Embed query
    vec = model.encode(
        [req.query],
        normalize_embeddings=True,
        convert_to_numpy=True,
    ).astype(np.float32)

    # 2. FAISS: retrieve enough candidates so filters have room to work.
    # With only 2,403 records, searching all of them is instant.
    candidates = (
        index.ntotal
        if (req.place or req.year_from or req.year_to)
        else min(50, index.ntotal)
    )
    scores, indices = index.search(vec, candidates)

    # 3. Build result list with metadata
    results = []
    for score, idx in zip(scores[0], indices[0]):
        if idx < 0:
            continue
        item = metadata_store[idx].copy()
        item["score"] = float(score)
        item["local_image_url"] = f"/images/{item['ppn']}/00000001.jpg"
        results.append(item)

    # 4. Apply filters
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

    # 5. Drop results below the minimum relevance threshold
    # (skip threshold when a place/year filter is active — the filter already
    # constrains the set, and the score reflects query-vs-card not place match)
    if not (req.place or req.year_from or req.year_to):
        results = [r for r in results if r["score"] >= MIN_SCORE]

    return {"results": results[: req.top_k], "total_candidates": len(results)}


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
    for i, r in enumerate(req.results, 1):
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
        "  Description — physical description and content of the card\n\n"
        'A researcher has asked: "{query}"\n\n'
        "Based on these catalogue records from the collection:\n\n"
        "{context}\n\n"
        "Instructions:\n"
        "- Provide a helpful, concise answer in English.\n"
        "- Reference specific cards by their number [1], [2] etc. where relevant.\n"
        "- If the researcher asks about a location, check the Place field of every record carefully.\n"
        "- Do NOT suggest external archives, other collections, or resources outside this catalogue.\n"
        "- If the records are weak matches or do not answer the question, say so briefly and stop."
    ).format(query=req.query, context=context)

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
