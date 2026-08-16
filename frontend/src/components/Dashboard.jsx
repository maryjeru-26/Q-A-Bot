import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const API = "http://127.0.0.1:8000";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function PdfSourcePage({ pdfData, page, highlight }) {
  const canvasRef = useRef(null);
  const [highlights, setHighlights] = useState([]);
  const [status, setStatus] = useState("Loading cited PDF page…");

  useEffect(() => {
    let cancelled = false;
    let task;
    const render = async () => {
      try {
        // PDF.js transfers its input buffer to its worker. React Strict Mode can
        // replay this effect in development, so always hand it a fresh buffer.
        task = pdfjsLib.getDocument({ data: pdfData.slice(0) });
        const pdf = await task.promise;
        const pdfPage = await pdf.getPage(Number(page));
        const viewport = pdfPage.getViewport({ scale: 1.55 });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const context = canvas.getContext("2d");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await pdfPage.render({ canvasContext: context, viewport }).promise;
        const textContent = await pdfPage.getTextContent();
        const words = new Set((highlight || "").toLowerCase().match(/[a-z]{4,}/g) || []);
        const found = [];
        for (const item of textContent.items) {
          const itemWords = (item.str || "").toLowerCase().match(/[a-z]{5,}/g) || [];
          // A line needs at least two meaningful words from the selected evidence.
          // This prevents generic page content (such as the drug name) being marked.
          if (itemWords.filter((word) => words.has(word)).length < 2) continue;
          const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
          const height = Math.hypot(transform[2], transform[3]);
          found.push({ left: transform[4], top: transform[5] - height, width: Math.max(item.width * viewport.scale, 8), height: Math.max(height, 10) });
          if (found.length >= 24) break;
        }
        if (!cancelled) { setHighlights(found); setStatus(found.length ? "Highlighted retrieved evidence on this page" : "Cited page"); }
      } catch (error) { if (!cancelled) setStatus(`Unable to render this PDF page: ${error.message || "unknown PDF error"}`); }
    };
    render();
    return () => { cancelled = true; task?.destroy(); };
  }, [pdfData, page, highlight]);

  return <div className="pdf-page-wrap"><p>{status}</p><div className="pdf-canvas-wrap"><canvas ref={canvasRef}/>{highlights.map((box, index) => <i className="pdf-highlight" key={index} style={{ left: box.left, top: box.top, width: box.width, height: box.height }}/>)}</div></div>;
}

function Dashboard() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [view, setView] = useState("chat");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState("");
  const [notice, setNotice] = useState("");
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState(null);
  const [sourcePreview, setSourcePreview] = useState(null);
  const [normalising, setNormalising] = useState({});
  const [recording, setRecording] = useState(false);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const messageCountRef = useRef(0);
  const recognitionRef = useRef(null);
  const token = localStorage.getItem("token");

  const request = async (path, options = {}) => {
    const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
    const response = await fetch(`${API}${path}`, { ...options, headers });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Request failed");
    return data;
  };
  const refreshSessions = async () => setSessions(await request("/api/sessions"));
  const refreshDocuments = async () => setDocuments(await request("/api/documents"));
  const refreshAnalytics = async () => {
    const [nextStats, nextActivity] = await Promise.all([request("/api/dashboard/stats"), request("/api/dashboard/activity")]);
    setStats(nextStats); setActivity(nextActivity);
  };

  useEffect(() => {
    if (!token) { navigate("/"); return; }
    Promise.all([refreshSessions(), refreshDocuments()]).catch((error) => setNotice(error.message));
  }, []);
  useEffect(() => { if (view === "dashboard") refreshAnalytics().catch((error) => setNotice(error.message)); }, [view]);
  useEffect(() => {
    const messageWasAdded = messages.length > messageCountRef.current;
    messageCountRef.current = messages.length;
    if (messageWasAdded || sending) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);
  useEffect(() => () => recognitionRef.current?.stop(), []);

  const newChat = async (documentId = null) => {
    try {
      const session = await request("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document_id: documentId }) });
      setSessions((items) => [session, ...items]); setActiveSession(session); setMessages([]); setView("chat"); setTimeout(() => inputRef.current?.focus(), 0);
    } catch (error) { setNotice(error.message); }
  };
  const openSession = async (session) => {
    try { const data = await request(`/api/sessions/${session.session_id}`); setActiveSession(data.session); setMessages(data.messages); setView("chat"); }
    catch (error) { setNotice(error.message); }
  };
  const removeSession = async (event, sessionId) => {
    event.stopPropagation(); if (!window.confirm("Delete this conversation?")) return;
    try { await request(`/api/sessions/${sessionId}`, { method: "DELETE" }); setSessions((all) => all.filter((s) => s.session_id !== sessionId)); if (activeSession?.session_id === sessionId) { setActiveSession(null); setMessages([]); } }
    catch (error) { setNotice(error.message); }
  };
  const renameSession = async () => {
    if (!activeSession) return; const title = window.prompt("Conversation name", activeSession.title); if (!title?.trim()) return;
    try { await request(`/api/sessions/${activeSession.session_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) }); const updated = { ...activeSession, title }; setActiveSession(updated); setSessions((all) => all.map((s) => s.session_id === updated.session_id ? updated : s)); }
    catch (error) { setNotice(error.message); }
  };
  const send = async (override) => {
    const question = (override || text).trim(); if (!question || sending) return;
    let session = activeSession;
    try {
      if (!session) { await newChat(); return; }
      setText(""); setSending(true); setMessages((items) => [...items, { role: "user", content: question, created_at: new Date().toISOString() }]);
      const data = await request("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: session.session_id, message: question, document_id: session.current_document_id || null }) });
      const assistant = { message_id: data.assistant_message_id, role: "assistant", content: data.answer, citations: data.citations, created_at: new Date().toISOString() };
      setMessages((items) => items.map((item, index) => index === items.length - 1 && item.role === "user" ? { ...item, message_id: data.user_message_id } : item).concat(assistant)); const updated = { ...session, title: data.title, updated_at: new Date().toISOString() }; setActiveSession(updated); setSessions((all) => [updated, ...all.filter((s) => s.session_id !== updated.session_id)]);
    } catch (error) { setNotice(error.message); setMessages((items) => items.slice(0, -1)); }
    finally { setSending(false); }
  };
  const upload = async (event) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) { setNotice("Please choose a PDF file."); return; }
    try { setUploading("Uploading PDF…"); const form = new FormData(); form.append("file", file); setUploading("Extracting text and creating embeddings…"); const data = await request("/api/upload", { method: "POST", body: form }); await refreshDocuments(); if (activeSession) await selectDocument(data.document.document_id); setNotice(`✓ Ready — ${data.document.file_name}: ${data.document.page_count} pages, ${data.document.chunk_count} chunks`); }
    catch (error) { setNotice(error.message); } finally { setUploading(""); }
  };
  const removeDocument = async (documentId) => {
    if (!window.confirm("Delete this PDF and its indexed chunks? This cannot be undone.")) return;
    try {
      await request(`/api/documents/${documentId}`, { method: "DELETE" });
      if (activeSession?.current_document_id === documentId) setActiveSession({ ...activeSession, current_document_id: null });
      await refreshDocuments();
      setNotice("Document and its vector index were deleted.");
    } catch (error) { setNotice(error.message); }
  };
  const removeQuestion = async (messageId) => {
    if (!messageId || !window.confirm("Delete this question and its answer?")) return;
    try {
      const result = await request(`/api/messages/${messageId}`, { method: "DELETE" });
      setMessages((items) => items.filter((item) => !result.deleted_message_ids.includes(item.message_id)));
      setNotice("Question removed from this conversation.");
    } catch (error) { setNotice(error.message); }
  };
  const normaliseAnswer = async (messageId) => {
    if (!messageId || normalising[messageId]) return;
    try {
      setNormalising((items) => ({ ...items, [messageId]: true }));
      const data = await request(`/api/messages/${messageId}/normalise`, { method: "POST" });
      setMessages((items) => items.map((item) => item.message_id === messageId ? { ...item, normalised_content: data.normalised_answer, showingNormalised: true } : item));
    } catch (error) { setNotice(error.message); }
    finally { setNormalising((items) => ({ ...items, [messageId]: false })); }
  };
  const downloadConversation = async (format) => {
    if (!activeSession) return;
    try {
      const response = await fetch(`${API}/api/sessions/${activeSession.session_id}/export?format=${format}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { const error = await response.json(); throw new Error(error.detail || "Unable to export conversation"); }
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const title = (activeSession.title || "conversation").replace(/[\\/:*?"<>|]/g, " ").trim() || "conversation";
      link.download = `${title}.${format}`;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(link.href);
    } catch (error) { setNotice(error.message); }
  };
  const toggleRecording = () => {
    if (recording) { recognitionRef.current?.stop(); return; }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setNotice("Voice input is not supported by this browser. Try Chrome or Microsoft Edge."); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => setRecording(true);
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) transcript += event.results[index][0].transcript;
      setText(transcript.trim());
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted") setNotice(event.error === "not-allowed" ? "Microphone access was denied. Allow microphone access and try again." : "Voice input could not be started. Please try again.");
    };
    recognition.onend = () => { setRecording(false); recognitionRef.current = null; inputRef.current?.focus(); };
    recognitionRef.current = recognition;
    recognition.start();
  };
  const openSource = async (citation, question = "") => {
    try {
      let evidence = citation.evidence, highlight = citation.highlight;
      if (!evidence || !highlight) {
        const evidenceResponse = await fetch(`${API}/api/documents/${citation.document_id}/pages/${citation.page}/evidence?question=${encodeURIComponent(question)}`, { headers: { Authorization: `Bearer ${token}` } });
        if (evidenceResponse.ok) { const data = await evidenceResponse.json(); evidence = data.evidence; highlight = data.highlight; }
      }
      const response = await fetch(`${API}/api/documents/${citation.document_id}/file`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { const error = await response.json(); throw new Error(error.detail || "Unable to open PDF"); }
      const pdfData = await response.arrayBuffer();
      setSourcePreview({ ...citation, evidence, highlight, pdfData });
    } catch (error) { setNotice(error.message); }
  };
  const closeSource = () => setSourcePreview(null);
  const selectDocument = async (documentId) => { if (!activeSession) return newChat(documentId); const updated = { ...activeSession, current_document_id: documentId }; setActiveSession(updated); await request(`/api/sessions/${updated.session_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document_id: documentId }) }); setSessions((all) => all.map((s) => s.session_id === updated.session_id ? updated : s)); setNotice("Document selected for this conversation."); };
  const logout = () => { localStorage.removeItem("token"); localStorage.removeItem("username"); navigate("/"); };
  const currentDoc = documents.find((d) => d.document_id === activeSession?.current_document_id);

  return <div className="rag-shell">
    <aside className="rag-sidebar">
      <div className="brand"><span>✦</span> Paperwise</div>
      <button className="new-chat" onClick={() => newChat()}>＋ New chat</button>
      <div className="side-label">Recent chats</div>
      <div className="session-list">{sessions.map((session) => <button key={session.session_id} className={`session-item ${activeSession?.session_id === session.session_id ? "active" : ""}`} onClick={() => openSession(session)}><span>◌ {session.title}</span><i onClick={(e) => removeSession(e, session.session_id)}>×</i></button>)}</div>
      <div className="sidebar-bottom"><button onClick={() => setView("documents")}>▣ Documents</button><button onClick={() => setView("dashboard")}>◫ Dashboard</button><button onClick={() => setView("guide")}>ⓘ How to use</button><button onClick={logout}>⇥ Logout</button></div>
    </aside>
    <main className="rag-main">
      {notice && <div className="notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}
      {view === "chat" && <section className="chat-view">
        <header className="chat-header"><div><h1>{activeSession?.title || "Document chat"}</h1><p>{currentDoc ? `Using ${currentDoc.file_name}` : "Choose a document or start asking"}</p></div>{activeSession && <div className="chat-header-actions"><button className="quiet" onClick={() => downloadConversation("txt")}>Download text</button><button className="quiet" onClick={() => downloadConversation("pdf")}>Download PDF</button><button className="quiet" onClick={renameSession}>Rename</button></div>}</header>
        <div className="messages" ref={scrollRef}>{!activeSession && <div className="welcome"><div className="welcome-mark">✦</div><h2>Ask your documents anything</h2><p>Start a new chat, choose a PDF, and get grounded answers with exact page sources.</p><button onClick={() => newChat()}>Start a conversation</button></div>}{messages.map((message, index) => <article className={`message ${message.role}`} key={`${message.created_at}-${index}`}><div className="avatar">{message.role === "assistant" ? "✦" : "You"}</div><div className="message-body"><div className="message-text">{message.showingNormalised ? message.normalised_content : message.content}</div>{message.showingNormalised && <div className="plain-language-label">Plain-language version</div>}{message.role === "user" && message.message_id && <div className="message-actions"><button className="delete-question" onClick={() => removeQuestion(message.message_id)}>Delete question</button></div>}{message.citations?.length > 0 && <div className="sources"><b>Sources</b>{message.citations.map((citation, i) => <button className="source-card" key={i} onClick={() => openSource(citation, messages[index - 1]?.role === "user" ? messages[index - 1].content : "")}>📄 <span>{citation.document}</span> · Page {citation.page}{citation.page_end !== citation.page ? `–${citation.page_end}` : ""}{citation.section ? ` · ${citation.section}` : ""}</button>)}</div>}{message.role === "assistant" && <div className="message-actions"><button onClick={() => navigator.clipboard?.writeText(message.showingNormalised ? message.normalised_content : message.content)}>Copy</button><button onClick={() => normaliseAnswer(message.message_id)} disabled={!message.message_id || normalising[message.message_id]}>{normalising[message.message_id] ? "Simplifying…" : "Normalise"}</button>{message.normalised_content && <button onClick={() => setMessages((items) => items.map((item) => item.message_id === message.message_id ? { ...item, showingNormalised: !item.showingNormalised } : item))}>{message.showingNormalised ? "Show original" : "Show simplified"}</button>}<button onClick={() => { const previous = messages[index - 1]; if (previous?.role === "user") send(previous.content); }}>Regenerate</button></div>}</div></article>)}{sending && <article className="message assistant"><div className="avatar">✦</div><div className="typing"><span></span><span></span><span></span></div></article>}</div>
        <footer className="composer"><div className="document-picker"><select value={activeSession?.current_document_id || ""} onChange={(e) => selectDocument(e.target.value || null)}><option value="">Default / select a document</option>{documents.map((doc) => <option value={doc.document_id} key={doc.document_id}>{doc.file_name}</option>)}</select><label className="upload-button">{uploading || "＋ Upload PDF"}<input type="file" accept="application/pdf,.pdf" onChange={upload} disabled={!!uploading}/></label></div><div className="input-row"><textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Ask about your document…" rows="1" disabled={!activeSession || sending}/><button className={`record-button ${recording ? "recording" : ""}`} onClick={toggleRecording} disabled={!activeSession || sending} aria-label={recording ? "Stop recording" : "Start voice input"} title={recording ? "Stop recording" : "Speak your question"}>{recording ? "■" : "🎙"}</button><button onClick={() => send()} disabled={!text.trim() || !activeSession || sending}>↑</button></div><small>{recording ? "Listening… Speak your question, then review it and press Enter." : "Paperwise can make mistakes. Check the source pages for important decisions."}</small></footer>
      </section>}
      {view === "documents" && <section className="page-view"><header><h1>Documents</h1><p>Your private, indexed PDF library.</p><label className="primary upload-button">{uploading || "＋ Upload PDF"}<input type="file" accept="application/pdf,.pdf" onChange={upload} disabled={!!uploading}/></label></header><div className="document-grid">{documents.map((doc) => <article className="document-card" key={doc.document_id}><div>📄</div><h3>{doc.file_name}</h3><p>{doc.page_count} pages · {doc.chunk_count} chunks</p><span>● Indexed</span><button onClick={() => { setView("chat"); activeSession ? selectDocument(doc.document_id) : newChat(doc.document_id); }}>Use in chat</button><button onClick={() => removeDocument(doc.document_id)}>Delete</button></article>)}</div></section>}
      {view === "guide" && <section className="page-view guide-view"><header><h1>How to use Paperwise</h1><p>Ask grounded questions about your PDFs in a few steps.</p></header><div className="guide-steps"><article><b>1</b><div><h2>Upload a PDF</h2><p>Open <strong>Documents</strong> in the sidebar and select <strong>Upload PDF</strong>. Wait until the file is indexed and marked Ready.</p></div></article><article><b>2</b><div><h2>Start a chat</h2><p>Select <strong>New chat</strong>, then choose the PDF you want to use from the document menu above the message box.</p></div></article><article><b>3</b><div><h2>Ask questions</h2><p>Type your question and press Enter or the send button. Use Shift + Enter to add a new line.</p></div></article><article><b>4</b><div><h2>Check the source</h2><p>Every answer shows the source PDF and the page where its primary evidence was retrieved. Open your PDF to verify important details.</p></div></article><article><b>5</b><div><h2>Continue or manage chats</h2><p>Your chats are saved automatically. Open them from Recent chats, rename or delete them, or delete an individual question with its answer.</p></div></article><article><b>6</b><div><h2>Review activity</h2><p>Open <strong>Dashboard</strong> to view your real query, session, document, and indexing statistics.</p></div></article></div></section>}
      {view === "dashboard" && <section className="page-view"><header><h1>Dashboard</h1><p>Activity and usage across your private workspace.</p></header><div className="stats-grid">{[["Total queries", stats?.total_queries], ["Total sessions", stats?.total_sessions], ["Total documents", stats?.total_documents], ["Indexed chunks", stats?.total_indexed_chunks], ["Queries / session", stats?.average_queries_per_session]].map(([label, value]) => <div className="stat-card" key={label}><span>{label}</span><strong>{value ?? "—"}</strong></div>)}</div><div className="analytics-grid"><article><h2>Recent activity</h2>{activity?.recent_queries?.length ? activity.recent_queries.map((query, i) => <div className="activity" key={i}><span>{new Date(query.created_at).toLocaleString()}</span><b>{query.query}</b><small>{query.session_title}</small></div>) : <p className="empty">Questions you ask will appear here.</p>}</article><article><h2>Most queried documents</h2>{activity?.most_queried_documents?.length ? activity.most_queried_documents.map((doc, i) => <div className="activity" key={i}><b>{doc.document}</b><small>{doc.queries} queries</small></div>) : <p className="empty">No document queries yet.</p>}</article><article><h2>Queries over time</h2>{activity?.queries_over_time?.map((item) => <div className="activity" key={item.date}><b>{item.date}</b><small>{item.count} queries</small></div>) || <p className="empty">No recent query data.</p>}</article><article><h2>Sessions over time</h2>{activity?.sessions_over_time?.map((item) => <div className="activity" key={item.date}><b>{item.date}</b><small>{item.count} sessions</small></div>) || <p className="empty">No recent session data.</p>}</article></div></section>}
      {sourcePreview && <div className="source-modal" role="dialog" aria-modal="true"><div className="source-modal-content"><header><div><h2>{sourcePreview.document}</h2><p>Page {sourcePreview.page}</p></div><button onClick={closeSource}>×</button></header><PdfSourcePage pdfData={sourcePreview.pdfData} page={sourcePreview.page} highlight={sourcePreview.highlight}/></div></div>}
    </main>
  </div>;
}
export default Dashboard;
