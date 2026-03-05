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

## Pending / Future Work

- **Smart Parse / query decomposition**: Pass natural language query to LLM first → extract `{ semantic_query, place, year_from, year_to, caveat }` → run search with structured params. Would reduce irrelevant high-scoring results and surface explicit limitations (e.g. "this query asks about food content not available in the metadata"). Keep as a toggle so both modes can be demoed side by side.
- **RAG-augmented chat (Option 3)**: When user asks a question in the per-card chat, also run a FAISS search with that question and include top 3–4 related cards as context. Enables answers like "there are 4 similar cards from Hamburg in this period."
- **Pre-aggregated stats (Option 4)**: Pass a small stats block to the chat: "47 other cards share this place, 12 share this date." Cheap, factual, no hallucination risk.
- **D3 visualisation**: Timeline / map of the collection using React state + D3 as a utility (Amelia Wattenberger approach — no D3 DOM manipulation, just scales and layouts).
