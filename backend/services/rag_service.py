import hashlib
import os
from pathlib import Path
from bson import ObjectId
from database import documents_collection
from .pdf_service import extract_pages, chunk_pages
from .embedding_service import embed_texts
from .chroma_service import index_chunks, search


def file_hash(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def index_pdf(path, user_id, is_default=False):
    path = Path(path)
    digest = file_hash(path)
    existing = documents_collection.find_one({"user_id": user_id, "file_hash": digest, "status": "indexed"})
    if existing:
        existing["_id"] = str(existing["_id"])
        existing["document_id"] = str(existing["_id"])
        return existing, False
    pages, page_count = extract_pages(path)
    chunks = chunk_pages(pages, int(os.getenv("CHUNK_SIZE", "1100")), int(os.getenv("CHUNK_OVERLAP", "180")))
    if not chunks:
        raise ValueError("No readable text was found in this PDF")
    document_id = str(ObjectId())
    embeddings = embed_texts([chunk["text"] for chunk in chunks])
    index_chunks(document_id, path.name, user_id, chunks, embeddings)
    document = {"_id": ObjectId(document_id), "user_id": user_id, "file_name": path.name,
                "file_type": "pdf", "page_count": page_count, "chunk_count": len(chunks),
                "status": "indexed", "file_hash": digest, "is_default": is_default,
                "created_at": __import__("datetime").datetime.utcnow()}
    documents_collection.insert_one(document)
    document["_id"] = document_id
    document["document_id"] = document_id
    return document, True


def ensure_default_document(user_id):
    data_dir = Path(__file__).resolve().parents[1] / "Data"
    pdfs = list(data_dir.glob("*.pdf")) if data_dir.exists() else []
    return index_pdf(pdfs[0], user_id, is_default=True)[0] if pdfs else None


def retrieve(user_id, question, document_id=None):
    return search(user_id, embed_texts([question])[0], document_id, int(os.getenv("TOP_K", "5")))
