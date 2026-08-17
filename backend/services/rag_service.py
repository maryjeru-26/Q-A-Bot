import hashlib
import os
import re
from pathlib import Path
from bson import ObjectId
from database import documents_collection
from .pdf_service import extract_pages, chunk_pages
from .embedding_service import embed_texts
from .chroma_service import index_chunks, search


NOT_FOUND_MESSAGE = "I couldn't find sufficient information about this in the uploaded document."

HEALTHCARE_SECTION_HEADERS = [
    "INDICATIONS AND USAGE",
    "CONTRAINDICATIONS",
    "WARNINGS AND PRECAUTIONS",
    "DOSAGE AND ADMINISTRATION",
    "ADVERSE REACTIONS",
    "DRUG INTERACTIONS",
]


def validate_healthcare_document(pages):
    """Return True only when at least two drug-label section headers are present."""
    text = " ".join(pages).upper()
    matches = sum(1 for header in HEALTHCARE_SECTION_HEADERS if header in text)
    return matches >= 2


def highlight_excerpt(text, question):
    """Return a small, query-specific label excerpt—not an entire page chunk."""
    intents = [
        (("dosage", "dose", "administration", "how often"), r"dosage and administration.{0,500}?(?:\.|$)"),
        (("contraindication", "should not", "not use"), r"contraindications?.{0,420}?(?:\.|$)"),
        (("warning", "precaution", "caution"), r"warnings? and precautions?.{0,500}?(?:\.|$)"),
        (("interaction", "taking", "with another"), r"drug interactions?.{0,500}?(?:\.|$)"),
        (("storage", "store", "temperature"), r"(?:storage|how supplied).{0,420}?(?:\.|$)"),
        (("missed", "forget"), r"(?:missed dose|if a dose.{0,120}missed).{0,420}?(?:\.|$)"),
    ]
    lowered = question.lower()
    for terms, pattern in intents:
        if any(term in lowered for term in terms):
            match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
            if match:
                return re.sub(r"\s+", " ", match.group(0)).strip()
    # A concise fallback avoids turning a broad retrieved page into a highlight.
    sentence = re.split(r"(?<=[.!?])\s+", text.strip())[0]
    return sentence[:450]


def build_retrieval_query(question, history):
    """Use same-session history only to resolve short follow-up questions."""
    lowered = question.lower()
    follow_up_markers = ("it", "its", "this drug", "this medication", "what about", "and ", "those")
    if len(question.split()) < 12 or any(marker in lowered for marker in follow_up_markers):
        previous_questions = [item["content"] for item in history if item.get("role") == "user"]
        if previous_questions:
            return f"Previous question: {previous_questions[-1]}\nCurrent question: {question}"
    return question


def has_sufficient_context(chunks):
    """Never send weak/no retrieval to the model as document evidence."""
    if not chunks:
        return False
    return chunks[0]["score"] >= float(os.getenv("MIN_RETRIEVAL_SCORE", "0.28"))


def is_patient_specific(question):
    terms = ("can i", "should i", "my ", "i am taking", "i'm taking", "pregnan",
             "breastfeed", "renal", "kidney", "liver", "interaction", "with another",
             "missed dose", "start", "stop", "change my dose", "condition")
    return any(term in question.lower() for term in terms)


def file_hash(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def index_pdf(path, user_id, is_default=False, display_name=None):
    path = Path(path)
    display_name = display_name or path.name
    digest = file_hash(path)
    existing = documents_collection.find_one({"user_id": user_id, "file_hash": digest, "status": "indexed"})
    if existing:
        existing["_id"] = str(existing["_id"])
        existing["document_id"] = str(existing["_id"])
        return existing, False
    pages, page_count = extract_pages(path)
    if not validate_healthcare_document(pages):
        raise ValueError("Document does not appear to be a healthcare or drug-label document.")
    chunks = chunk_pages(pages, int(os.getenv("CHUNK_SIZE", "1100")), int(os.getenv("CHUNK_OVERLAP", "180")))
    if not chunks:
        raise ValueError("No readable text was found in this PDF")
    document_id = str(ObjectId())
    embeddings = embed_texts([chunk["text"] for chunk in chunks])
    index_chunks(document_id, display_name, user_id, chunks, embeddings)
    document = {"_id": ObjectId(document_id), "user_id": user_id, "file_name": display_name,
                "file_type": "pdf", "page_count": page_count, "chunk_count": len(chunks),
                "status": "indexed", "file_hash": digest, "is_default": is_default,
                "stored_path": str(path.resolve()),
                "created_at": __import__("datetime").datetime.utcnow()}
    documents_collection.insert_one(document)
    document["_id"] = document_id
    document["document_id"] = document_id
    return document, True


def ensure_default_document(user_id):
    data_dir = Path(__file__).resolve().parents[1] / "Data"
    pdfs = list(data_dir.glob("*.pdf")) if data_dir.exists() else []
    return index_pdf(pdfs[0], user_id, is_default=True)[0] if pdfs else None


def retrieve(user_id, question, document_id=None, history=None):
    query = build_retrieval_query(question, history or [])
    return search(user_id, embed_texts([query])[0], document_id, int(os.getenv("TOP_K", "5")))
