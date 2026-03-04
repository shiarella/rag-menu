# RAG Menu Cards

Semantic search over 2,403 historical menu cards from the [Staatsbibliothek zu Berlin](https://staatsbibliothek-berlin.de/), with a local LLM archivist powered by Ollama.

## Stack

| Layer | Technology |
|---|---|
| Embeddings | `paraphrase-multilingual-MiniLM-L12-v2` (384-dim, multilingual) |
| Vector index | FAISS `IndexFlatIP` (cosine similarity via unit normalisation) |
| API | FastAPI + uvicorn |
| LLM archivist | Ollama `llama3.2` (local, no API key needed) |
| Frontend | Next.js 15 + Tailwind CSS |

## Project structure

```
api/            FastAPI backend — /search, /generate, /facets
pipeline/       embed.py — one-time script to build FAISS index from metadata.csv
frontend/       Next.js search UI
data/           (gitignored) index.faiss, metadata_store.json, MenuCardsDataset/
```

## Setup

### 1. Python environment

```bash
python -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn sentence-transformers faiss-cpu httpx
```

### 2. Build the index (once)

Place `metadata.csv` and `MenuCardsDataset/` in `data/`, then:

```bash
.venv/bin/python pipeline/embed.py
```

### 3. Start the API

```bash
.venv/bin/uvicorn api.main:app --reload --port 8000
```

### 4. Install and start Ollama

```bash
brew install ollama
ollama pull llama3.2
ollama serve   # runs on http://localhost:11434
```

### 5. Start the frontend

```bash
cd frontend
npm install
npm run dev    # http://localhost:3000
```
