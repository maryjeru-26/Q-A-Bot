from datetime import datetime, timedelta
from pathlib import Path
import shutil
import uuid
from bson import ObjectId
from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware

from database import (users_collection, sessions_collection, messages_collection,
                      documents_collection, query_logs_collection)
from models import UserRegister, UserLogin
from auth import hash_password, verify_password, create_token, get_current_user
from services.rag_service import (ensure_default_document, index_pdf, retrieve,
                                  has_sufficient_context, is_patient_specific,
                                  NOT_FOUND_MESSAGE, highlight_excerpt)
from services.llm_service import generate_answer
from services.chroma_service import delete_document as delete_chroma_document, evidence_for_page


app = FastAPI()


class SessionCreate(BaseModel):
    document_id: str | None = None


class SessionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    document_id: str | None = None


class ChatRequest(BaseModel):
    session_id: str
    message: str = Field(min_length=1, max_length=8000)
    document_id: str | None = None




app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)




@app.get("/")
def home():
    return {
        "message": "FastAPI server is running"
    }




@app.post("/register")
def register(user: UserRegister):

    existing_user = users_collection.find_one({
        "email": user.email
    })

    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Email already registered"
        )

    hashed_password = hash_password(user.password)

    new_user = {
        "username": user.username,
        "email": user.email,
        "password": hashed_password
    }

    result = users_collection.insert_one(new_user)

    return {
        "message": "Registration successful",
        "user_id": str(result.inserted_id)
    }




@app.post("/login")
def login(user: UserLogin):

    existing_user = users_collection.find_one({
        "email": user.email
    })

    if not existing_user:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )

    password_correct = verify_password(
        user.password,
        existing_user["password"]
    )

    if not password_correct:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )

    token = create_token(
        str(existing_user["_id"]),
        existing_user["username"]
    )

    return {
        "message": "Login successful",
        "token": token,
        "username": existing_user["username"]
    }


def serialize_document(document):
    document["document_id"] = str(document.pop("_id"))
    document.pop("stored_path", None)
    return document


def serialize_session(session):
    session.pop("_id", None)
    return session


@app.get("/api/documents")
def list_documents(current_user=Depends(get_current_user)):
    # Default content is indexed once per user/hash, maintaining strict vector isolation.
    ensure_default_document(current_user["user_id"])
    return [serialize_document(doc) for doc in documents_collection.find({"user_id": current_user["user_id"]}).sort("created_at", -1)]


@app.post("/api/upload")
def upload_pdf(file: UploadFile = File(...), current_user=Depends(get_current_user)):
    if not file.filename or not file.filename.lower().endswith(".pdf") or file.content_type not in {"application/pdf", "application/x-pdf"}:
        raise HTTPException(400, "Only PDF files are supported")
    upload_dir = Path(__file__).resolve().parent / "uploads" / current_user["user_id"]
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(file.filename).name
    target = upload_dir / f"{uuid.uuid4()}_{safe_name}"
    with target.open("wb") as output:
        shutil.copyfileobj(file.file, output)
    try:
        document, created = index_pdf(target, current_user["user_id"], display_name=safe_name)
        return {"status": "ready", "indexed": created, "document": document}
    except Exception:
        target.unlink(missing_ok=True)
        raise HTTPException(400, "Unable to index this PDF. Ensure it is a readable, text-based PDF and try again.")


@app.delete("/api/documents/{document_id}")
def remove_document(document_id: str, current_user=Depends(get_current_user)):
    document = documents_collection.find_one({"_id": ObjectId(document_id) if ObjectId.is_valid(document_id) else None,
                                               "user_id": current_user["user_id"]})
    if not document:
        raise HTTPException(404, "Document not found")
    delete_chroma_document(current_user["user_id"], document_id)
    documents_collection.delete_one({"_id": document["_id"]})
    sessions_collection.update_many({"user_id": current_user["user_id"], "current_document_id": document_id},
                                    {"$set": {"current_document_id": None}})
    return {"message": "Document deleted"}


@app.get("/api/documents/{document_id}")
def get_document(document_id: str, current_user=Depends(get_current_user)):
    if not ObjectId.is_valid(document_id):
        raise HTTPException(404, "Document not found")
    document = documents_collection.find_one({"_id": ObjectId(document_id), "user_id": current_user["user_id"]})
    if not document:
        raise HTTPException(404, "Document not found")
    return serialize_document(document)


@app.get("/api/documents/{document_id}/file")
def get_document_file(document_id: str, current_user=Depends(get_current_user)):
    """Serve a PDF only after ownership verification; it is never public/static."""
    if not ObjectId.is_valid(document_id):
        raise HTTPException(404, "Document not found")
    document = documents_collection.find_one({"_id": ObjectId(document_id), "user_id": current_user["user_id"]})
    if not document:
        raise HTTPException(404, "Document not found")
    path_value = document.get("stored_path")
    path = Path(path_value) if path_value else None
    # Supports documents that were indexed before stored_path was introduced.
    if not path or not path.is_file():
        if document.get("is_default"):
            candidate = Path(__file__).resolve().parent / "Data" / document["file_name"]
        else:
            candidates = list((Path(__file__).resolve().parent / "uploads" / current_user["user_id"]).glob(f"*_{document['file_name']}"))
            candidate = candidates[0] if candidates else None
        path = candidate
    if not path or not path.is_file():
        raise HTTPException(404, "The original PDF file is no longer available")
    return FileResponse(path, media_type="application/pdf", filename=document["file_name"], headers={"Cache-Control": "private, no-store"})


@app.get("/api/documents/{document_id}/pages/{page}/evidence")
def get_page_evidence(document_id: str, page: int, question: str = "", current_user=Depends(get_current_user)):
    if not ObjectId.is_valid(document_id) or page < 1:
        raise HTTPException(404, "Document page not found")
    document = documents_collection.find_one({"_id": ObjectId(document_id), "user_id": current_user["user_id"]})
    if not document:
        raise HTTPException(404, "Document not found")
    evidence = evidence_for_page(current_user["user_id"], document_id, page)
    if not evidence:
        raise HTTPException(404, "No indexed evidence is available for this page")
    return {"evidence": evidence, "highlight": highlight_excerpt(evidence, question)}


@app.post("/api/sessions")
def create_session(request: SessionCreate, current_user=Depends(get_current_user)):
    if request.document_id and not documents_collection.find_one({"_id": ObjectId(request.document_id) if ObjectId.is_valid(request.document_id) else None, "user_id": current_user["user_id"]}):
        raise HTTPException(404, "Document not found")
    session = {"session_id": f"session_{uuid.uuid4().hex}", "user_id": current_user["user_id"],
               "title": "New conversation", "current_document_id": request.document_id,
               "created_at": datetime.utcnow(), "updated_at": datetime.utcnow()}
    sessions_collection.insert_one(session)
    return serialize_session(session)


@app.get("/api/sessions")
def list_sessions(current_user=Depends(get_current_user)):
    return [serialize_session(item) for item in sessions_collection.find({"user_id": current_user["user_id"]}).sort("updated_at", -1)]


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str, current_user=Depends(get_current_user)):
    session = sessions_collection.find_one({"session_id": session_id, "user_id": current_user["user_id"]})
    if not session:
        raise HTTPException(404, "Session not found")
    messages = list(messages_collection.find({"session_id": session_id, "user_id": current_user["user_id"]}, {"_id": 0}).sort("created_at", 1))
    return {"session": serialize_session(session), "messages": messages}


@app.patch("/api/sessions/{session_id}")
def rename_session(session_id: str, request: SessionUpdate, current_user=Depends(get_current_user)):
    updates = {"updated_at": datetime.utcnow()}
    if request.title is not None:
        updates["title"] = request.title.strip()
    if request.document_id is not None:
        if not ObjectId.is_valid(request.document_id) or not documents_collection.find_one({"_id": ObjectId(request.document_id), "user_id": current_user["user_id"]}):
            raise HTTPException(404, "Document not found")
        updates["current_document_id"] = request.document_id
    result = sessions_collection.update_one({"session_id": session_id, "user_id": current_user["user_id"]},
                                            {"$set": updates})
    if not result.matched_count:
        raise HTTPException(404, "Session not found")
    return {"message": "Session renamed"}


@app.delete("/api/sessions/{session_id}")
def remove_session(session_id: str, current_user=Depends(get_current_user)):
    result = sessions_collection.delete_one({"session_id": session_id, "user_id": current_user["user_id"]})
    if not result.deleted_count:
        raise HTTPException(404, "Session not found")
    messages_collection.delete_many({"session_id": session_id, "user_id": current_user["user_id"]})
    query_logs_collection.delete_many({"session_id": session_id, "user_id": current_user["user_id"]})
    return {"message": "Session deleted"}


@app.delete("/api/messages/{message_id}")
def remove_message(message_id: str, current_user=Depends(get_current_user)):
    """Delete one user question and its directly linked answer, if present."""
    user_id = current_user["user_id"]
    message = messages_collection.find_one({"message_id": message_id, "user_id": user_id})
    if not message:
        raise HTTPException(404, "Message not found")
    deleted_ids = [message_id]
    messages_collection.delete_one({"_id": message["_id"]})
    if message["role"] == "user":
        linked = list(messages_collection.find({"parent_message_id": message_id, "user_id": user_id}, {"message_id": 1}))
        linked_ids = [item["message_id"] for item in linked]
        if linked_ids:
            messages_collection.delete_many({"message_id": {"$in": linked_ids}, "user_id": user_id})
            deleted_ids.extend(linked_ids)
    return {"message": "Question deleted", "deleted_message_ids": deleted_ids}


@app.post("/api/chat")
def chat(request: ChatRequest, current_user=Depends(get_current_user)):
    user_id = current_user["user_id"]
    session = sessions_collection.find_one({"session_id": request.session_id, "user_id": user_id})
    if not session:
        raise HTTPException(404, "Session not found")
    document_id = request.document_id or session.get("current_document_id")
    if document_id and not documents_collection.find_one({"_id": ObjectId(document_id) if ObjectId.is_valid(document_id) else None, "user_id": user_id}):
        raise HTTPException(404, "Document not found")
    if not document_id:
        default_document = ensure_default_document(user_id)
        if not default_document:
            raise HTTPException(400, "No PDF is available. Upload a PDF to begin.")
        document_id = default_document["document_id"]
    history = list(messages_collection.find({"session_id": request.session_id, "user_id": user_id}, {"_id": 0, "role": 1, "content": 1}).sort("created_at", -1).limit(12))
    history.reverse()
    chunks = retrieve(user_id, request.message, document_id, history)
    patient_specific = is_patient_specific(request.message)
    if not has_sufficient_context(chunks):
        answer = NOT_FOUND_MESSAGE
        if patient_specific:
            answer += " Please consult a qualified healthcare professional for advice specific to your situation."
        chunks = []
    else:
        try:
            answer = generate_answer(history, request.message, chunks, patient_specific)
        except Exception:
            raise HTTPException(503, "Answer generation is temporarily unavailable. Please try again.")
    # Present one clear, authoritative source card: the highest-ranked retrieved
    # chunk. The answer may use additional context internally, but the displayed
    # page is always metadata from this real retrieval result.
    citations = []
    if chunks:
        meta = chunks[0]["metadata"]
        citations = [{"document": meta["document_name"], "document_id": meta["document_id"],
                      "page": meta["page_start"], "page_end": meta["page_end"],
                      "section": meta.get("section") or None, "evidence": chunks[0]["text"],
                      "highlight": highlight_excerpt(chunks[0]["text"], request.message)}]
    now = datetime.utcnow()
    user_message_id, assistant_message_id = str(uuid.uuid4()), str(uuid.uuid4())
    messages_collection.insert_many([
        {"message_id": user_message_id, "session_id": request.session_id, "user_id": user_id, "role": "user", "content": request.message, "created_at": now},
        {"message_id": assistant_message_id, "parent_message_id": user_message_id, "session_id": request.session_id, "user_id": user_id, "role": "assistant", "content": answer, "citations": citations, "created_at": now},
    ])
    if session["title"] == "New conversation":
        title = " ".join(request.message.strip().split()[:7]).capitalize()
    else:
        title = session["title"]
    sessions_collection.update_one({"_id": session["_id"]}, {"$set": {"title": title, "current_document_id": document_id, "updated_at": now}})
    retrieved = [{"chunk_id": item["chunk_id"], "document": item["metadata"]["document_name"],
                  "page": item["metadata"]["page_start"], "page_end": item["metadata"]["page_end"],
                  "score": item["score"]} for item in chunks]
    query_logs_collection.insert_one({"user_id": user_id, "session_id": request.session_id, "query": request.message,
                                      "document_id": document_id, "retrieved_chunks": retrieved, "citations": citations,
                                      "answer": answer, "created_at": now})
    return {"answer": answer, "citations": citations, "retrieved_chunks": retrieved, "title": title,
            "user_message_id": user_message_id, "assistant_message_id": assistant_message_id}


@app.get("/api/dashboard/stats")
def dashboard_stats(current_user=Depends(get_current_user)):
    user_id = current_user["user_id"]
    queries = query_logs_collection.count_documents({"user_id": user_id})
    sessions = sessions_collection.count_documents({"user_id": user_id})
    documents = documents_collection.count_documents({"user_id": user_id})
    chunks = sum(item.get("chunk_count", 0) for item in documents_collection.find({"user_id": user_id}, {"chunk_count": 1}))
    return {"total_queries": queries, "total_sessions": sessions, "total_documents": documents,
            "total_indexed_chunks": chunks, "average_queries_per_session": round(queries / sessions, 1) if sessions else 0}


@app.get("/api/dashboard/activity")
def dashboard_activity(current_user=Depends(get_current_user)):
    user_id = current_user["user_id"]
    recent_queries = list(query_logs_collection.find({"user_id": user_id}, {"_id": 0, "query": 1, "session_id": 1, "document_id": 1, "created_at": 1}).sort("created_at", -1).limit(12))
    session_titles = {item["session_id"]: item["title"] for item in sessions_collection.find({"user_id": user_id}, {"session_id": 1, "title": 1})}
    for item in recent_queries:
        item["session_title"] = session_titles.get(item["session_id"], "Conversation")
    by_document = list(query_logs_collection.aggregate([
        {"$match": {"user_id": user_id}}, {"$group": {"_id": "$document_id", "queries": {"$sum": 1}}}, {"$sort": {"queries": -1}}, {"$limit": 5}
    ]))
    names = {str(item["_id"]): item["file_name"] for item in documents_collection.find({"user_id": user_id}, {"file_name": 1})}
    since = datetime.utcnow() - timedelta(days=6)
    def daily(collection):
        return list(collection.aggregate([
            {"$match": {"user_id": user_id, "created_at": {"$gte": since}}},
            {"$group": {"_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}}, "count": {"$sum": 1}}},
            {"$sort": {"_id": 1}}
        ]))
    return {"recent_queries": recent_queries,
            "most_queried_documents": [{"document": names.get(item["_id"], "Deleted document"), "queries": item["queries"]} for item in by_document],
            "queries_over_time": [{"date": item["_id"], "count": item["count"]} for item in daily(query_logs_collection)],
            "sessions_over_time": [{"date": item["_id"], "count": item["count"]} for item in daily(sessions_collection)]}
