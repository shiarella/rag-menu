# Architecture & Design Decisions

## Data

- **Metadata store** (`data/metadata_store.json`): 2,403 JSON records — text fields only (title, subtitle, date, place, description, PPN, IIIF URLs). These are **librarian catalogue descriptions of the physical card object**, not transcriptions of the menu text itself.
- **FAISS index** (`data/index.faiss`): 2,403 dense vectors (embeddings) — one per card, linked by position to the metadata store. Used for semantic similarity search only.
- **Embedding model**: `paraphrase-multilingual-MiniLM-L12-v2` — multilingual, so German and English queries both work.

## Search

- **No server-side score threshold** — we removed `MIN_SCORE`. The frontend lets users filter by relevance via a slider. Rationale: threshold was arbitrary and hiding valid results.
- **Full index search** — FAISS searches all 2,403 records every query (`index.ntotal`), not a capped `top_k`. Fast enough at this scale (~instant).
- **Score interpretation**: cosine similarity in embedding space, NOT probability of match. Because the collection is topically narrow (all menu cards), scores are naturally compressed — even "irrelevant" cards score 55–65% because they share vocabulary ("Diner", "Menü", "Speisefolge"). A 60% score does not mean 60% confidence of relevance.
- **Scores are honest but misleading at face value** — this is a known limitation of dense retrieval on narrow-domain collections. The AI interpretation layer is partly there to help users make sense of this.

## AI / LLM

- **Local Ollama** (`llama3.2`) — no API key, no cost, no data leaving the machine. Important for a library context (patron privacy, data sovereignty).
- **`/generate` endpoint**: page-level RAG — interprets the 12 cards currently shown. Sends metadata fields, not image content.
- **`/chat` endpoint**: per-card multi-turn chat. Uses Ollama's `/api/chat` (conversation history preserved). Grounded only in the single card's catalogue record.
- **Hallucination risk**: The model will invent dish names and food content if not constrained. The description field describes the physical card (paper, printing, format), NOT the menu text. Prompt explicitly warns the model about this.
- **Why the model can't answer food-content queries well**: The catalogue never transcribed the menu text — only the physical object was catalogued. To know what dishes are listed, you have to look at the card images (→ IIIF viewer).

## IIIF Viewer

- **Self-hosted Universal Viewer** — UV files copied from `node_modules/universalviewer/dist/` to `public/uv/`. Served from our own Next.js app at `/uv/uv.html`.
- **Why not Clover IIIF?** Clover is React-native but uses Hyperion to parse manifests. SBB manifests have some annotations missing `body`/`motivation` fields (non-spec-compliant), causing runtime errors. UV is more lenient and is the viewer SBB and Bodleian use themselves.
- **Why not the hosted universalviewer.io iframe?** External dependency — if that site is slow or down, the viewer fails. Self-hosting eliminates this.
- **Image data source**: All images and manifests are fetched live from SBB's servers (`content.staatsbibliothek-berlin.de`). We serve the viewer, they serve the content.

## Frontend

- **Next.js 14 App Router** — server components for the card detail page (SEO, fast load), client components for search and chat.
- **`/card/[ppn]`** — slug pages per card. PPN is the SBB catalogue identifier, also used as the IIIF manifest path.
- **Client-side pagination** — all results fetched once, paginated in the browser. Instant page turns, works for 2,403 records.
- **`filtersDirty` state** — button rings and hint text appears when filters change after a search, prompting re-search. Prevents stale results.

## Search Quality Evaluation (2025-03-05)

Ran 8 test queries against the live API (`eval_search.py`) to assess FAISS retrieval quality before LLM interpretation.

| Query                                      | Max score | Quality      | Notes                                                                           |
| ------------------------------------------ | --------- | ------------ | ------------------------------------------------------------------------------- |
| "Hohenzollern yacht imperial dinner"       | **80%**   | ✅ Excellent | Named entity — `S.M. Yacht Hohenzollern` cards rank top 5                       |
| "dinner Berlin hotel 1900" (+ year filter) | **80%**   | ✅ Excellent | Central Hotel, Monopol-Hotel, Wilhelm II birthday all surface                   |
| "wedding banquet celebration"              | **69%**   | ✅ Good      | Correctly retrieves `Hochzeitsessen` / `Hochzeitsfeier` in German               |
| "elegant dinner on a ship"                 | **70%**   | ✅ Good      | Top result is NY imperial breakfast; ship/yacht cards cluster                   |
| "Speisekarte Dampfer Hamburg"              | **75%**   | ✅ Good      | German query works; `Dampfer "Kaiser Wilhelm"` is direct hit                    |
| "Christmas dinner menu"                    | **56%**   | ⚠️ Weak      | No Christmas-specific card exists — concept absent from catalogue fields        |
| "vegetarian menu"                          | **59%**   | ⚠️ Weak      | Retrieves `Buffet`/`Lunch` cards — vegetarian not a 19c cataloguing concept     |
| "menus with Polish food"                   | **61%**   | ❌ Noise     | Score spread top-12 is only 3 points (61–58%) — purely undifferentiated results |

**Key finding — the 61% ceiling:** For food-content queries, max scores cluster near 60% with tiny spread. This is the model finding vaguely "dinner-ish" cards with no real discrimination. The catalogue **never transcribed menu text** — only physical object described. Any query asking about food content, cuisine type, or specific dishes will hit this ceiling.

**Why the Archivist hallucinates on these queries:** When all 12 cards score 58–61% and none contain food-content metadata, the LLM invents connections (e.g. "Souper = Polish connection") to fill the gap. The prompt mitigations help but don't eliminate this.

**Good presentation example:** "vegetarian menu" — visually demonstrates the catalogue limitation in a sympathetic way (the concept of a vegetarian option simply didn't exist as a cataloguing category in the 1890s).

**Score distribution note:** For a poorly-matched query, `p50` (median score) is 34.3% and max is 61.2%. This confirms that even the "top" results for a food-content query are only a few points above the mid-field — the ranking carries no real signal.

## Query Decomposition / Smart Parse (2026-03-05)

- **`POST /parse` endpoint** — takes a natural language query, runs it through `llama3.2` at `temperature=0`, returns `{ semantic_query, place, year_from, year_to, caveat }`.
- **Few-shot prompted** — the prompt uses 6 input/output examples rather than abstract rules. This was more reliable than rule-following instructions for `llama3.2`.
- **semantic_query**: boilerplate stripped ("show me menus with…" → gone), but query otherwise passed through. NOT creatively rewritten — earlier attempts at "rewrite as a clean phrase" caused hallucination (gibberish → "elegant dinner").
- **place**: only extracted if a proper noun — "ship" is not a place, "Hamburg" is. Took an explicit rule + a ship example to get this right.
- **caveat**: LLM-authored warning, shown in an amber box in the UI. Fires for food-content queries ("specific dishes cannot be searched") and for meaningless input ("Invalid input. Please rephrase"). The phrasing is entirely LLM-generated — emergent from training data, not hardcoded.
- **Toggle in UI** — "Smart Parse" pill switch below the search bar. Off by default so both modes can be compared. When on, shows a "searched as: …" chip with the rewritten semantic query.
- **Parse evaluation**: tested 8 queries via `eval_parse.py`. Key results: boilerplate stripping ✅, proper-noun place extraction ✅, year decade extraction ✅, food-content caveat ✅, gibberish passthrough ✅ (falls back to original if `semantic_query` is blank).
- **Prompt iteration history**: went through ~5 prompt versions. "Copy as-is" caused passthrough of noise. "Rewrite as clean phrase" caused hallucination. Few-shot examples with an explicit proper-noun rule was the winning approach.

## Metadata Enrichment via OCR — v2 Index (2026-03-05)

**Problem:** The v1 metadata-only index cannot answer food-content queries ("vegetarian menu", "Polish food") because catalogue descriptions are physical object descriptions, not menu text transcriptions.

**Decision:** Build a v2 FAISS index that concatenates original metadata fields with Tesseract OCR text extracted from the card images.

**Why Tesseract not llama3.2-vision:**

- Tesseract: ~1s/card → full collection in ~40 min, free, local
- llama3.2-vision: ~10–30s/card → 7–20 hours for full collection, impractical for precompute
- Vision model adds value for layout, decoration, handwriting — but text extraction speed matters here

**Why brew install not pip install:**

- Tesseract is a C++ binary with language data files (~500MB). It cannot be pip-installed.
- `pytesseract` (pip) is a thin Python wrapper that shells out to the system binary.
- `brew install tesseract tesseract-lang` installs the engine; pip installs the Python bridge.

**OCR quality findings (5-card sample):**

- ~40–60% of cards will yield useful text (dish names, headings, prices readable)
- Ornate decorative cards / cards with only a printer credit = near-zero yield
- Handwritten cards = garbled output
- German + Fraktur (`deu+frk`) language pack needed; plain `deu` misses Fraktur glyphs
- Average ~1s/card across the mix

**OCR precompute results (run 5 March 2026):**

| Metric                  | Value                 |
| ----------------------- | --------------------- |
| Total cards             | 2,303                 |
| Useful text (>20 chars) | 2,039 (88.5%)         |
| Empty / garbled         | 264 (11.5%)           |
| Missing images          | 0                     |
| Wall-clock time         | 39.4 min              |
| Output                  | `data/ocr_store.json` |

Empty/garbled cards are predominantly ornate royal or commemorative menus where decorative typography defeats Tesseract. These cards still appear in search via the metadata index.

**Index architecture (revised — late fusion):**

- `build_ocr.py` → `data/ocr_store.json` (ppn → raw OCR text, checkpointed every 50 cards)
- `build_index_v2.py` → embeds **OCR text only** (not concatenated) → `data/index_ocr.faiss` + `data/metadata_store_ocr.json` (only cards with ≥30 chars OCR)

**OCR index build results (run 5 March 2026):**

| Metric                               | Value                     |
| ------------------------------------ | ------------------------- | ------------------------------ |
| Cards embedded                       | 2,070 / 2,403 (86%)       |
| Skipped (OCR < 30 chars)             | 333                       |
| Embedding time                       | ~6 s (batch_size=64, CPU) |
| Vector dimensions                    | 384                       |
| Output index                         | `data/index_ocr.faiss`    |
| - API: `search_mode` field (`"meta"` | `"ocr"`                   | `"both"`) in `/search` request |

- `"both"` = late fusion: query each index independently, merge by `max(meta_score, ocr_score)`
- Frontend: multi-select checkboxes (Metadata / OCR); CLIP and Vision LLM shown as coming-soon

**Why keep v1:** Direct A/B comparison is the most compelling demo of what OCR enrichment adds. Showing the same query returning different results with/without OCR text makes the improvement concrete and tangible for a presentation audience.

## Pending / Future Work

- **RAG-augmented chat (Option 3)**: When user asks a question in the per-card chat, also run a FAISS search with that question and include top 3–4 related cards as context. Enables answers like "there are 4 similar cards from Hamburg in this period."
- **Pre-aggregated stats (Option 4)**: Pass a small stats block to the chat: "47 other cards share this place, 12 share this date." Cheap, factual, no hallucination risk.
- **D3 visualisation**: Timeline / map of the collection using React state + D3 as a utility (Amelia Wattenberger approach — no D3 DOM manipulation, just scales and layouts).
