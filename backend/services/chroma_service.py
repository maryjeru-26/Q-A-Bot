import os
from pathlib import Path
from functools import lru_cache
import chromadb


@lru_cache(maxsize=1)
def collection():
    base = Path(__file__).resolve().parents[1]
    path = os.getenv("CHROMA_PATH", str(base / "chroma_db"))
    client = chromadb.PersistentClient(path=path)
    return client.get_or_create_collection("document_chunks", metadata={"hnsw:space": "cosine"})


def index_chunks(document_id, document_name, user_id, chunks, embeddings):
    ids = [f"{user_id}:{document_id}:{index}" for index in range(len(chunks))]
    metadata = [{"document_id": document_id, "document_name": document_name,
                 "user_id": user_id, "page_start": item["page_start"],
                 "page_end": item["page_end"], "page_number": item["page_start"],
                 "section": item.get("section") or "", "source": "uploaded_pdf"}
                for item in chunks]
    collection().upsert(ids=ids, documents=[item["text"] for item in chunks],
                        embeddings=embeddings, metadatas=metadata)
    return ids


def search(user_id, query_embedding, document_id=None, top_k=5):
    where = {"user_id": user_id}
    if document_id:
        where = {"$and": [{"user_id": user_id}, {"document_id": document_id}]}
    result = collection().query(query_embeddings=[query_embedding], n_results=top_k,
                                where=where, include=["documents", "metadatas", "distances"])
    output = []
    for chunk_id, text, meta, distance in zip(result.get("ids", [[]])[0], result.get("documents", [[]])[0],
                                              result.get("metadatas", [[]])[0], result.get("distances", [[]])[0]):
        output.append({"chunk_id": chunk_id, "text": text, "metadata": meta,
                       "score": round(1 - float(distance), 4)})
    return output


def delete_document(user_id, document_id):
    collection().delete(where={"$and": [{"user_id": user_id}, {"document_id": document_id}]})
