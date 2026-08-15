import os


def generate_answer(history, question, chunks, patient_specific=False):
    api_key = os.getenv("GROQ_API") or os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("Groq API key is not configured on the server")
    from groq import Groq
    history_text = "\n".join(f"{m['role'].title()}: {m['content']}" for m in history[-10:]) or "(No prior conversation)"
    sources = "\n\n".join(
        f"SOURCE {i + 1}\nDocument: {c['metadata']['document_name']}\n"
        f"Pages: {c['metadata']['page_start']}-{c['metadata']['page_end']}\n"
        f"Section: {c['metadata'].get('section') or 'Not specified'}\n{c['text']}"
        for i, c in enumerate(chunks)
    ) or "(No relevant document passages were retrieved.)"
    system = ("You are a grounded drug-label information assistant, not a doctor. The RETRIEVED DOCUMENT SOURCES "
              "are the only factual authority. Conversation history may resolve pronouns but is never evidence. "
              "Do not use medical general knowledge or infer missing facts. Never diagnose, prescribe, recommend a "
              "dose change, advise starting/stopping treatment, or claim an interaction/contraindication unless it is "
              "explicitly stated in the sources. Preserve key medical terms and explain them plainly when useful. "
              "If the sources do not sufficiently answer the question, respond exactly: 'I couldn't find sufficient "
              "information about this in the uploaded document.' Do not invent citations, page numbers, or a Sources "
              "heading; the application renders verified citation metadata.")
    if patient_specific:
        system += (" This is a patient-specific or treatment-related question. State what the label says, state what "
                   "cannot be determined from it, and end with: '⚠️ This information is based on the uploaded "
                   "prescribing document and is not a substitute for advice from a qualified healthcare professional.'")
    prompt = f"CONVERSATION HISTORY:\n{history_text}\n\nRETRIEVED DOCUMENT SOURCES:\n{sources}\n\nCURRENT QUESTION:\n{question}"
    client = Groq(api_key=api_key)
    response = client.chat.completions.create(
        model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"),
        messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        temperature=0.2,
    )
    return response.choices[0].message.content.strip()


def normalise_answer(answer):
    """Rewrite a generated answer for a general audience without changing its meaning."""
    api_key = os.getenv("GROQ_API") or os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("Groq API key is not configured on the server")

    from groq import Groq

    system = (
        "You rewrite healthcare and medicine information for a general audience. "
        "Use simple, everyday language and short sentences. Keep every fact, number, "
        "medicine name, warning, limitation, and instruction exactly consistent with the "
        "original answer. Do not add medical knowledge, diagnosis, recommendations, or "
        "advice. If a medical term must remain, explain it briefly in plain language. "
        "Keep any healthcare-professional disclaimer. Return only the simplified answer."
    )
    client = Groq(api_key=api_key)
    response = client.chat.completions.create(
        model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"),
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": f"ORIGINAL ANSWER:\n{answer}"},
        ],
        temperature=0.1,
    )
    return response.choices[0].message.content.strip()
