"""
embed.py — Build FAISS index from metadata.csv

Outputs:
  data/index.faiss          — FAISS flat L2 index
  data/metadata_store.json  — list of dicts, index-aligned with FAISS vectors

Run:
  .venv/bin/python pipeline/embed.py
"""

import csv
import json
import pathlib

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer

# ── Paths ──────────────────────────────────────────────────────────────────────
ROOT = pathlib.Path(__file__).parent.parent
CSV_PATH = ROOT / "data" / "metadata.csv"
INDEX_PATH = ROOT / "data" / "index.faiss"
STORE_PATH = ROOT / "data" / "metadata_store.json"

# ── Model ──────────────────────────────────────────────────────────────────────
MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"


# ── IIIF Image API URL template ────────────────────────────────────────────────
def iiif_image_url(ppn: str) -> str:
    return f"https://content.staatsbibliothek-berlin.de/dc/{ppn}-0001/full/400,/0/default.jpg"


def build_text(row: dict) -> str:
    parts = [
        row.get("Subtitle", ""),
        row.get("Description", ""),
        row.get("Place", ""),
        row.get("Date", ""),
    ]
    return " ".join(p.strip() for p in parts if p.strip())


def main():
    print(f"Reading {CSV_PATH} …")
    rows = []
    texts = []

    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ppn = row.get("PPN", "").strip()
            if not ppn:
                continue
            text = build_text(row)
            texts.append(text)
            rows.append(
                {
                    "ppn": ppn,
                    "title": row.get("Title", "").strip(),
                    "subtitle": row.get("Subtitle", "").strip(),
                    "description": row.get("Description", "").strip(),
                    "place": row.get("Place", "").strip(),
                    "date": row.get("Date", "").strip(),
                    "iiif_manifest_url": row.get("IIIF_Manifest_URL", "").strip(),
                    "iiif_image_url": iiif_image_url(ppn),
                }
            )

    print(f"  → {len(rows)} records loaded")

    print(f"Loading model '{MODEL_NAME}' …")
    model = SentenceTransformer(MODEL_NAME)

    print("Encoding texts …")
    embeddings = model.encode(
        texts,
        batch_size=64,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )
    embeddings = embeddings.astype(np.float32)

    dim = embeddings.shape[1]
    print(f"  → Embedding dim: {dim}, shape: {embeddings.shape}")

    print("Building FAISS index …")
    index = faiss.IndexFlatIP(dim)  # Inner product = cosine sim when normalised
    index.add(embeddings)
    faiss.write_index(index, str(INDEX_PATH))
    print(f"  → Saved to {INDEX_PATH}")

    with open(STORE_PATH, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    print(f"  → Saved metadata to {STORE_PATH}")

    print("Done ✓")


if __name__ == "__main__":
    main()
