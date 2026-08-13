import re
from pathlib import Path
from pypdf import PdfReader


def extract_pages(path: Path):
    reader = PdfReader(str(path))
    pages = []
    for number, page in enumerate(reader.pages, start=1):
        text = re.sub(r"\s+", " ", page.extract_text() or "").strip()
        if text:
            pages.append({"page": number, "text": text})
    return pages, len(reader.pages)


def chunk_pages(pages, chunk_size=1100, overlap=180):
    """Chunk each page; no chunk can silently lose its source page metadata."""
    chunks = []
    for item in pages:
        text, page = item["text"], item["page"]
        start = 0
        while start < len(text):
            end = min(len(text), start + chunk_size)
            if end < len(text):
                boundary = text.rfind(" ", start, end)
                if boundary > start + chunk_size // 2:
                    end = boundary
            value = text[start:end].strip()
            if value:
                chunks.append({"text": value, "page_start": page, "page_end": page,
                               "section": ""})
            if end >= len(text):
                break
            start = max(end - overlap, start + 1)
    return chunks
