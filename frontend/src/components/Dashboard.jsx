import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const API = "http://127.0.0.1:8000";

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
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
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
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, sending]);

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
        <header className="chat-header"><div><h1>{activeSession?.title || "Document chat"}</h1><p>{currentDoc ? `Using ${currentDoc.file_name}` : "Choose a document or start asking"}</p></div>{activeSession && <button className="quiet" onClick={renameSession}>Rename</button>}</header>
        <div className="messages" ref={scrollRef}>{!activeSession && <div className="welcome"><div className="welcome-mark">✦</div><h2>Ask your documents anything</h2><p>Start a new chat, choose a PDF, and get grounded answers with exact page sources.</p><button onClick={() => newChat()}>Start a conversation</button></div>}{messages.map((message, index) => <article className={`message ${message.role}`} key={`${message.created_at}-${index}`}><div className="avatar">{message.role === "assistant" ? "✦" : "You"}</div><div className="message-body"><div className="message-text">{message.content}</div>{message.role === "user" && message.message_id && <div className="message-actions"><button className="delete-question" onClick={() => removeQuestion(message.message_id)}>Delete question</button></div>}{message.citations?.length > 0 && <div className="sources"><b>Sources</b>{message.citations.map((citation, i) => <div className="source-card" key={i}>📄 <span>{citation.document}</span> · Page {citation.page}{citation.page_end !== citation.page ? `–${citation.page_end}` : ""}{citation.section ? ` · ${citation.section}` : ""}</div>)}</div>}{message.role === "assistant" && <div className="message-actions"><button onClick={() => navigator.clipboard?.writeText(message.content)}>Copy</button><button onClick={() => { const previous = messages[index - 1]; if (previous?.role === "user") send(previous.content); }}>Regenerate</button></div>}</div></article>)}{sending && <article className="message assistant"><div className="avatar">✦</div><div className="typing"><span></span><span></span><span></span></div></article>}</div>
        <footer className="composer"><div className="document-picker"><select value={activeSession?.current_document_id || ""} onChange={(e) => selectDocument(e.target.value || null)}><option value="">Default / select a document</option>{documents.map((doc) => <option value={doc.document_id} key={doc.document_id}>{doc.file_name}</option>)}</select><label className="upload-button">{uploading || "＋ Upload PDF"}<input type="file" accept="application/pdf,.pdf" onChange={upload} disabled={!!uploading}/></label></div><div className="input-row"><textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Ask about your document…" rows="1" disabled={!activeSession || sending}/><button onClick={() => send()} disabled={!text.trim() || !activeSession || sending}>↑</button></div><small>Paperwise can make mistakes. Check the source pages for important decisions.</small></footer>
      </section>}
      {view === "documents" && <section className="page-view"><header><h1>Documents</h1><p>Your private, indexed PDF library.</p><label className="primary upload-button">{uploading || "＋ Upload PDF"}<input type="file" accept="application/pdf,.pdf" onChange={upload} disabled={!!uploading}/></label></header><div className="document-grid">{documents.map((doc) => <article className="document-card" key={doc.document_id}><div>📄</div><h3>{doc.file_name}</h3><p>{doc.page_count} pages · {doc.chunk_count} chunks</p><span>● Indexed</span><button onClick={() => { setView("chat"); activeSession ? selectDocument(doc.document_id) : newChat(doc.document_id); }}>Use in chat</button><button onClick={() => removeDocument(doc.document_id)}>Delete</button></article>)}</div></section>}
      {view === "guide" && <section className="page-view guide-view"><header><h1>How to use Paperwise</h1><p>Ask grounded questions about your PDFs in a few steps.</p></header><div className="guide-steps"><article><b>1</b><div><h2>Upload a PDF</h2><p>Open <strong>Documents</strong> in the sidebar and select <strong>Upload PDF</strong>. Wait until the file is indexed and marked Ready.</p></div></article><article><b>2</b><div><h2>Start a chat</h2><p>Select <strong>New chat</strong>, then choose the PDF you want to use from the document menu above the message box.</p></div></article><article><b>3</b><div><h2>Ask questions</h2><p>Type your question and press Enter or the send button. Use Shift + Enter to add a new line.</p></div></article><article><b>4</b><div><h2>Check the source</h2><p>Every answer shows the source PDF and the page where its primary evidence was retrieved. Open your PDF to verify important details.</p></div></article><article><b>5</b><div><h2>Continue or manage chats</h2><p>Your chats are saved automatically. Open them from Recent chats, rename or delete them, or delete an individual question with its answer.</p></div></article><article><b>6</b><div><h2>Review activity</h2><p>Open <strong>Dashboard</strong> to view your real query, session, document, and indexing statistics.</p></div></article></div></section>}
      {view === "dashboard" && <section className="page-view"><header><h1>Dashboard</h1><p>Activity and usage across your private workspace.</p></header><div className="stats-grid">{[["Total queries", stats?.total_queries], ["Total sessions", stats?.total_sessions], ["Total documents", stats?.total_documents], ["Indexed chunks", stats?.total_indexed_chunks], ["Queries / session", stats?.average_queries_per_session]].map(([label, value]) => <div className="stat-card" key={label}><span>{label}</span><strong>{value ?? "—"}</strong></div>)}</div><div className="analytics-grid"><article><h2>Recent activity</h2>{activity?.recent_queries?.length ? activity.recent_queries.map((query, i) => <div className="activity" key={i}><span>{new Date(query.created_at).toLocaleString()}</span><b>{query.query}</b><small>{query.session_title}</small></div>) : <p className="empty">Questions you ask will appear here.</p>}</article><article><h2>Most queried documents</h2>{activity?.most_queried_documents?.length ? activity.most_queried_documents.map((doc, i) => <div className="activity" key={i}><b>{doc.document}</b><small>{doc.queries} queries</small></div>) : <p className="empty">No document queries yet.</p>}</article><article><h2>Queries over time</h2>{activity?.queries_over_time?.map((item) => <div className="activity" key={item.date}><b>{item.date}</b><small>{item.count} queries</small></div>) || <p className="empty">No recent query data.</p>}</article><article><h2>Sessions over time</h2>{activity?.sessions_over_time?.map((item) => <div className="activity" key={item.date}><b>{item.date}</b><small>{item.count} sessions</small></div>) || <p className="empty">No recent session data.</p>}</article></div></section>}
    </main>
  </div>;
}
export default Dashboard;
