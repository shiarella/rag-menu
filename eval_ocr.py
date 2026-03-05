import time, json
from pathlib import Path
from PIL import Image
import pytesseract

DATASET = Path("data/MenuCardsDataset")
META = json.load(open("data/metadata_store.json"))

# Pick 5 cards spread across the collection
ppns = [m["ppn"] for m in META[::480]][:5]

for ppn in ppns:
    img_path = DATASET / ppn / "00000001.jpg"
    if not img_path.exists():
        print(f"{ppn}: no image\n")
        continue

    meta = next(m for m in META if m["ppn"] == ppn)
    print(f"{'='*60}")
    print(f"PPN:   {ppn}")
    print(f"Title: {meta.get('subtitle','')}")
    print(f"Date:  {meta.get('date','')}  Place: {meta.get('place','')}")

    t0 = time.time()
    img = Image.open(img_path)
    # Try German + Fraktur
    text = pytesseract.image_to_string(img, lang="deu+frk")
    elapsed = time.time() - t0

    # Print first 400 non-empty chars
    clean = " ".join(text.split())[:400]
    print(f"OCR ({elapsed:.1f}s): {clean}")
    print()
