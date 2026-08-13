import os


def generate_answer(history, question, chunks):
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
    system = ("You are a careful PDF documentation assistant. Answer only from RETRIEVED DOCUMENT SOURCES. "
              "Conversation history helps resolve references but is not evidence. Do not fabricate facts, documents, "
              "page numbers, or citations. If the sources do not answer the question, say exactly that sufficient "
              "information was not found in the document. Do not add a Sources section; the application supplies it.")
    prompt = f"CONVERSATION HISTORY:\n{history_text}\n\nRETRIEVED DOCUMENT SOURCES:\n{sources}\n\nCURRENT QUESTION:\n{question}"
    client = Groq(api_key=api_key)
    response = client.chat.completions.create(
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        temperature=0.2,
    )
    return response.choices[0].message.content.strip()
