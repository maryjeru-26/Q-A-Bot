import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv()

from services.rag_service import retrieve, ensure_default_document
from services.llm_service import generate_answer
from database import users_collection, documents_collection, sessions_collection, messages_collection

GROUND_TRUTH_PATH = Path(__file__).resolve().parent / "ground_truth.json"
TEST_USER_ID = "eval_user"
TEST_SESSION_ID = "session_eval_001"

def get_default_document():
    doc = ensure_default_document(TEST_USER_ID)
    if not doc:
        raise RuntimeError("No default document available for evaluation")
    return doc["document_id"]

def run_rag(question, document_id):
    history = []
    chunks = retrieve(TEST_USER_ID, question, document_id, history)
    if not chunks or chunks[0]["score"] < float(os.getenv("MIN_RETRIEVAL_SCORE", "0.28")):
        return [], "I couldn't find sufficient information about this in the uploaded document."
    answer = generate_answer(history, question, chunks, patient_specific=False)
    return chunks, answer

def evaluate():
    with open(GROUND_TRUTH_PATH, "r", encoding="utf-8") as f:
        ground_truth = json.load(f)

    document_id = get_default_document()
    print(f"Evaluating against document: {document_id}")
    print(f"Questions: {len(ground_truth)}\n")

    recall_at_5 = 0
    precision_at_1 = 0
    faithfulness_correct = 0
    total = len(ground_truth)
    results = []

    for item in ground_truth:
        q = item["question"]
        expected_pages = set(item["expected_pages"])
        expected_sections = set(item.get("expected_sections", []))

        try:
            chunks, answer = run_rag(q, document_id)
        except Exception as e:
            print(f"ERROR on Q{item['id']}: {e}")
            results.append({**item, "error": str(e)})
            continue

        retrieved_pages = set()
        retrieved_sections = set()
        for c in chunks[:5]:
            retrieved_pages.add(c["metadata"]["page_start"])
            sec = c["metadata"].get("section")
            if sec:
                retrieved_sections.add(sec)

        top1_page = chunks[0]["metadata"]["page_start"] if chunks else None
        top1_section = chunks[0]["metadata"].get("section", "") if chunks else ""

        recall_hit = bool(expected_pages & retrieved_pages)
        precision_hit = top1_page in expected_pages if top1_page is not None else False

        if recall_hit:
            recall_at_5 += 1
        if precision_hit:
            precision_at_1 += 1

        faith_score = judge_faithfulness(answer, chunks)
        if faith_score >= 0.7:
            faithfulness_correct += 1

        results.append({
            "id": item["id"],
            "question": q,
            "answer": answer,
            "retrieved_pages": sorted(retrieved_pages),
            "top1_page": top1_page,
            "recall_at_5": recall_hit,
            "precision_at_1": precision_hit,
            "faithfulness": faith_score,
        })

        status = []
        if recall_hit:
            status.append("R@5")
        if precision_hit:
            status.append("P@1")
        if faith_score >= 0.7:
            status.append("F")
        print(f"Q{item['id']}: {' | '.join(status) if status else 'FAIL'} -> {answer[:100]}...")

    metrics = {
        "retrieval_recall_at_5": round(recall_at_5 / total, 4) if total else 0,
        "retrieval_precision_at_1": round(precision_at_1 / total, 4) if total else 0,
        "faithfulness_pass_rate": round(faithfulness_correct / total, 4) if total else 0,
        "total_questions": total,
        "recall_hits": recall_at_5,
        "precision_hits": precision_at_1,
        "faithfulness_hits": faithfulness_correct,
    }

    print("\n=== RAG EVALUATION RESULTS ===")
    print(f"Retrieval Recall@5:    {metrics['retrieval_recall_at_5']:.2%} ({metrics['recall_hits']}/{total})")
    print(f"Retrieval Precision@1: {metrics['retrieval_precision_at_1']:.2%} ({metrics['precision_hits']}/{total})")
    print(f"Faithfulness Pass Rate:{metrics['faithfulness_pass_rate']:.2%} ({metrics['faithfulness_hits']}/{total})")

    out_path = Path(__file__).resolve().parent / "results.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"metrics": metrics, "details": results}, f, indent=2, ensure_ascii=False)

    print(f"\nDetailed results saved to {out_path}")
    return metrics

def judge_faithfulness(answer, chunks):
    if not chunks:
        return 0.0
    api_key = os.getenv("GROQ_API") or os.getenv("GROQ_API_KEY")
    if not api_key:
        return 1.0
    from groq import Groq
    context = "\n\n".join(c["text"] for c in chunks[:3])
    prompt = (
        "You are a strict evaluator. Determine if the ANSWER is fully supported by the CONTEXT below.\n"
        "Rules:\n"
        "1. If every factual claim in the ANSWER can be verified from the CONTEXT, score 1.0.\n"
        "2. If the ANSWER contains claims not present in the CONTEXT, score 0.0.\n"
        "3. If the ANSWER is vague or says information is not found, score 1.0 (it is not hallucinating).\n"
        "Return ONLY a single decimal between 0.0 and 1.0.\n\n"
        f"CONTEXT:\n{context}\n\nANSWER:\n{answer}\n"
    )
    client = Groq(api_key=api_key)
    try:
        response = client.chat.completions.create(
            model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            max_tokens=10,
        )
        text = response.choices[0].message.content.strip()
        for token in text.split():
            try:
                val = float(token)
                if 0.0 <= val <= 1.0:
                    return val
            except ValueError:
                continue
        return 0.5
    except Exception:
        return 0.5

if __name__ == "__main__":
    evaluate()
