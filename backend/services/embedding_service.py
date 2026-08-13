import os
from functools import lru_cache


@lru_cache(maxsize=1)
def get_embedding_model():
    # Loaded only when a document/query needs embeddings, not during API startup.
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2"))


def embed_texts(texts):
    if not texts:
        return []
    return get_embedding_model().encode(texts, normalize_embeddings=True).tolist()
