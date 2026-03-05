"""
build_ocr.py — Step 1 of v2 index pipeline.

Runs Tesseract (deu+frk) on the first page of every card in MenuCardsDataset,
writes data/ocr_store.json: { ppn: ocr_text, ... }

Skips cards already processed (safe to resume if interrupted).
Prints progress every 50 cards and a final summary.
"""

import json
import time
from pathlib import Path

from PIL import Image
import pytesseract

DATASET = Path("data/MenuCardsDataset")
META_PATH = Path("data/metadata_store.json")
OUT_PATH = Path("data/ocr_store.json")

meta = json.load(open(META_PATH))
ppns = [m["ppn"] for m in meta]

# Load existing results so we can resume
if OUT_PATH.exists():
    ocr_store = json.load(open(OUT_PATH))
    print(f"Resuming — {len(ocr_store)} already done")
else:
    ocr_store = {}

todo = [p for p in ppns if p not in ocr_store]
print(f"Cards to process: {len(todo)} of {len(ppns)}")

t_start = time.time()
n_ok = 0
n_empty = 0
n_missing = 0

for i, ppn in enumerate(todo, 1):
    img_path = DATASET / ppn / "00000001.jpg"
    if not img_path.exists():
        ocr_store[ppn] = ""
        n_missing += 1
        continue

    try:
        img = Image.open(img_path)
        text = pytesseract.image_to_string(img, lang="deu+frk")
        clean = " ".join(text.split())  # collapse whitespace
        ocr_store[ppn] = clean
        if len(clean) > 20:
            n_ok += 1
        else:
            n_empty += 1
    except Exception as e:
        ocr_store[ppn] = ""
        n_empty += 1

    # Save checkpoint every 50 cards
    if i % 50 == 0:
        json.dump(ocr_store, open(OUT_PATH, "w"), ensure_ascii=False)
        elapsed = time.time() - t_start
        rate = elapsed / i
        remaining = rate * (len(todo) - i)
        print(
            f"  [{i}/{len(todo)}] {elapsed:.0f}s elapsed, ~{remaining/60:.0f} min remaining"
        )

# Final save
json.dump(ocr_store, open(OUT_PATH, "w"), ensure_ascii=False)

total = time.time() - t_start
print(f"\nDone in {total/60:.1f} min")
print(f"  Useful text (>20 chars): {n_ok}")
print(f"  Empty/garbled:           {n_empty}")
print(f"  Missing image:           {n_missing}")
print(f"  Output: {OUT_PATH}")
