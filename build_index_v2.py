"""
build_index_v2.py — builds the OCR-only FAISS index.

Embeds the raw Tesseract text for each card that has useful OCR output,
producing a second index that can be queried independently or fused with
the metadata index at search time (late fusion).

Outputs:
  data/index_ocr.faiss          — FAISS index of OCR embeddings
  data/metadata_store_ocr.json  — parallel metadata list (same fields as v1
                                   + ocr_text), one entry per indexed card.
                                   Only cards with useful OCR are included.

Run after build_ocr.py has produced data/ocr_store.json.
"""

import json
import numpy as np
import faiss
from pathlib import Path
from sentence_transformers import SentenceTransformer

META_PATH = Path("data/metadata_store.json")
OCR_PATH = Path("data/ocr_store.json")
OUT_INDEX = Path("data/index_ocr.faiss")
OUT_META = Path("data/metadata_store_ocr.json")
MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"

# Cards whose OCR text is shorter than this are skipped —
# they have too little signal to be worth embedding.
MIN_OCR_CHARS = 30

print("Loading metadata and OCR store...")
meta_by_ppn = {r["ppn"]: r for r in json.load(open(META_PATH))}
ocr = json.load(open(OCR_PATH)) if OCR_PATH.exists() else {}

useful = {ppn: text for ppn, text in ocr.items() if len(text.strip()) >= MIN_OCR_CHARS}
print(
    f"Cards with useful OCR (>={MIN_OCR_CHARS} chars): {len(useful)} / {len(meta_by_ppn)}"
)

print(f"Loading embedding model: {MODEL_NAME}")
model = SentenceTransformer(MODEL_NAME)

texts = []
meta_ocr = []

for ppn, ocr_text in useful.items():
    if ppn not in meta_by_ppn:
        continue  # OCR ran but card not in metadata — skip
    texts.append(ocr_text)  # embed OCR text only
    r = meta_by_ppn[ppn].copy()
    r["ocr_text"] = ocr_text
    meta_ocr.append(r)

print(f"Embedding {len(texts)} records (OCR text only)...")
vectors = model.encode(
    texts,
    normalize_embeddings=True,
    convert_to_numpy=True,
    show_progress_bar=True,
    batch_size=64,
).astype(np.float32)

print("Building FAISS index...")
dim = vectors.shape[1]
index = faiss.IndexFlatIP(dim)
index.add(vectors)

faiss.write_index(index, str(OUT_INDEX))
json.dump(meta_ocr, open(OUT_META, "w"), ensure_ascii=False, indent=2)

print(f"\nDone.")
print(f"  Index:    {OUT_INDEX}  ({index.ntotal} vectors, dim={dim})")
print(f"  Metadata: {OUT_META}")
print(
    f"  Coverage: {len(meta_ocr)} / {len(meta_by_ppn)} cards ({100*len(meta_ocr)/len(meta_by_ppn):.0f}%)"
)
