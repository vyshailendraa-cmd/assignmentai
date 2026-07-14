import { useState, useRef, useEffect } from "react";
import Papa from "papaparse";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from "recharts";

// ── Disciplines ─────────────────────────────────────────────────────────
const DISCIPLINES = [
  { id: "auto", label: "Auto-detect", icon: "✨" },
  { id: "physics", label: "Physics / Science", icon: "⚛️" },
  { id: "business", label: "Business", icon: "📈" },
  { id: "law", label: "Law", icon: "⚖️" },
  { id: "economics", label: "Economics", icon: "💹" },
  { id: "engineering", label: "Engineering", icon: "⚙️" },
  { id: "psychology", label: "Psychology", icon: "🧠" },
];

// ── Sample datasets (STEM demos) ────────────────────────────────────────
const SAMPLES = [
  { name: "Muon Lifetime", tag: "Physics", gen: () => {
    const tau=2.2, rows=[];
    for(let i=0;i<79;i++){const t=0.5+i*(19.5/78),c=Math.max(0,Math.round(420*Math.exp(-t/tau)+5+(Math.random()-.5)*Math.sqrt(420*Math.exp(-t/tau)+5)*2));rows.push({time_us:+t.toFixed(3),counts:c})}return rows;
  }},
  { name: "XRF Spectrum", tag: "Physics", gen: () => {
    const rows=[],pks=[[6.4,.08,800],[8.04,.09,500],[8.63,.09,350],[10.55,.1,250]];for(let i=0;i<500;i++){const E=1+(i/499)*14;let bg=200*Math.exp(-.3*E)+30;for(const[c,s,a]of pks)bg+=a*Math.exp(-.5*((E-c)/s)**2);rows.push({energy_keV:+E.toFixed(3),counts:Math.max(0,Math.round(bg+(Math.random()-.5)*Math.sqrt(bg)*2))})}return rows;
  }},
  { name: "Hubble Diagram", tag: "Astro", gen: () => {
    const rows=[],ds=Array.from({length:60},()=>10+Math.random()*490).sort((a,b)=>a-b);for(const d of ds){rows.push({distance_Mpc:+d.toFixed(1),recession_velocity_kms:+(70*d+(Math.random()-.5)*600).toFixed(1)})}return rows;
  }},
  { name: "Sales Performance", tag: "Business", gen: () => {
    const rows=[];const regions=["North","South","East","West"];let month=0;
    for(let m=1;m<=12;m++){for(const r of regions){rows.push({month:m,region:r,revenue_k:+(80+m*6+(r==="North"?25:r==="West"?10:0)+(Math.random()-.5)*30).toFixed(1),units_sold:Math.round(120+m*8+(Math.random()-.5)*40)})}}return rows;
  }},
  { name: "GDP vs Unemployment", tag: "Econ", gen: () => {
    const rows=[];for(let i=0;i<40;i++){const gdp=(Math.random()*6-1);rows.push({quarter:i+1,gdp_growth_pct:+gdp.toFixed(2),unemployment_pct:+(6.5-0.45*gdp+(Math.random()-.5)*0.8).toFixed(2)})}return rows;
  }},
];

// ── Prompt builder ──────────────────────────────────────────────────────
const buildPrompt = (discipline, csvSnippet, totalRows, columns, userContext, hasPdf) => `You are an academic assignment assistant that produces high-quality DRAFT reports for university students. The output is a structured mock report the student uses as a reference/starting point.

DISCIPLINE: ${discipline === "auto" ? "Detect from the brief/data" : discipline}
${hasPdf ? "The student attached their assignment brief / instruction sheet as a PDF. Follow its required structure, questions, and marking criteria EXACTLY. Address every task listed in it." : ""}
${userContext ? `STUDENT'S DESCRIPTION: ${userContext}` : ""}
${csvSnippet ? `DATA (CSV, first 80 rows):
${csvSnippet}
Total rows: ${totalRows} | Columns: ${columns.join(", ")}` : ""}

Produce a complete draft appropriate to the discipline:
- Physics/Science/Engineering: lab report (aim, theory, method, results, error analysis, discussion, conclusion)
- Business: business report (executive summary, situation analysis, framework application e.g. SWOT/Porter's, findings, recommendations)
- Law: legal memo/essay (issue, rule, application, conclusion — IRAC — or essay structure with authorities)
- Economics: analytical report (question, model/theory, data analysis, interpretation, policy implications)
- Psychology: APA-style report (abstract, introduction, method, results, discussion)

CRITICAL OUTPUT RULES:
1. Respond with ONLY a JSON object. No text before or after. No markdown fences. Start your response with { and end with }.
2. Use this exact schema:
{
  "title": "Full title",
  "discipline": "detected or given discipline",
  "summary": "One-line key takeaway/result",
  "sections": [
    {"heading": "Section name", "content": "Full section text, multiple paragraphs allowed"}
  ],
  "chart": ${csvSnippet ? `{"x_col": "exact column name", "y_col": "exact column name", "x_label": "label (units)", "y_label": "label (units)", "caption": "what the chart shows"}` : "null"},
  "key_figures": [{"name": "metric/parameter name", "value": "value with units", "meaning": "what it represents"}]
}
3. sections must have 5-8 entries matching the discipline's standard structure.
4. Write at genuine university level — specific, rigorous, no filler.`;

// ── Robust JSON extraction ──────────────────────────────────────────────
function extractJSON(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object found in response");
  const sliced = cleaned.slice(start, end + 1);
  try { return JSON.parse(sliced); } catch (e) {
    // Attempt to fix common issues: trailing commas
    const fixed = sliced.replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(fixed);
  }
}

export default function App() {
  const [mode, setMode] = useState("home");
  const [discipline, setDiscipline] = useState("auto");
  const [data, setData] = useState(null);
  const [columns, setColumns] = useState([]);
  const [label, setLabel] = useState("");
  const [pdfB64, setPdfB64] = useState(null);
  const [pdfName, setPdfName] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [userContext, setUserContext] = useState("");
  const csvRef = useRef(); const pdfRef = useRef(); const chatCsvRef = useRef(); const chatPdfRef = useRef(); const chatEnd = useRef();

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [chatHistory, loading]);

  // ── File handlers ─────────────────────────────────────────────────────
  const parseCSVText = (text, name) => {
    const result = Papa.parse(text.trim(), { header: true, dynamicTyping: true, skipEmptyLines: true });
    if (!result.data.length) { setErr("CSV appears empty"); return false; }
    setData(result.data); setColumns(Object.keys(result.data[0])); setLabel(name); setErr(null);
    return true;
  };

  const handleCSVFile = (f, goPreview = true) => {
    const reader = new FileReader();
    reader.onload = (e) => { if (parseCSVText(e.target.result, f.name.replace(".csv","")) && goPreview) setMode("preview"); };
    reader.readAsText(f);
  };

  const handlePDFFile = (f) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setPdfB64(e.target.result.split(",")[1]); setPdfName(f.name); setErr(null);
      if (mode === "home") setMode("preview");
    };
    reader.onerror = () => setErr("Failed to read PDF");
    reader.readAsDataURL(f);
  };

  const loadSample = (s) => {
    const rows = s.gen(); setData(rows); setColumns(Object.keys(rows[0])); setLabel(s.name); setMode("preview"); setErr(null);
  };

  // ── API ───────────────────────────────────────────────────────────────
  const callAPI = async (csvSnippet, totalRows, cols, context) => {
    let res;
    try {
      res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: buildPrompt(discipline, csvSnippet, totalRows, cols, context, !!pdfB64),
          pdfB64,
          pdfName
        })
      });
    } catch (e) { throw new Error("Network request failed: " + e.message); }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body.slice(0, 240)}`);
    }
    const d = await res.json();
    if (!d.text) throw new Error("The model returned an empty response");
    return extractJSON(d.text);
  };

  const generate = async (context = "") => {
    setLoading(true); setErr(null);
    try {
      let csv = null, total = 0, cols = [];
      if (data) {
        cols = columns; total = data.length;
        csv = [cols.join(","), ...data.slice(0, 80).map(r => cols.map(c => r[c]).join(","))].join("\n");
      }
      const rpt = await callAPI(csv, total, cols, context || userContext);
      setReport(rpt); setMode("report");
    } catch (e) { setErr("Generation failed: " + e.message); }
    finally { setLoading(false); }
  };

  // ── Chat ──────────────────────────────────────────────────────────────
  const sendChat = async () => {
    if (!chatInput.trim()) return;
    const msg = chatInput.trim(); setChatInput("");
    setChatHistory(prev => [...prev, { role: "user", text: msg }]);

    const lines = msg.split("\n").filter(l => l.includes(",") || l.includes("\t"));
    if (lines.length >= 3) {
      const result = Papa.parse(lines.join("\n").replace(/\t/g, ","), { header: true, dynamicTyping: true, skipEmptyLines: true });
      if (result.data.length > 0) {
        setData(result.data); setColumns(Object.keys(result.data[0])); setLabel("Pasted data");
        setChatHistory(prev => [...prev, { role: "ai", text: `Got it — ${result.data.length} rows detected. Generating...` }]);
        const ctx = [...chatHistory.filter(m => m.role === "user").map(m => m.text), msg].join(" ");
        setLoading(true); setErr(null);
        try {
          const cols = Object.keys(result.data[0]);
          const csv = [cols.join(","), ...result.data.slice(0, 80).map(r => cols.map(c => r[c]).join(","))].join("\n");
          const rpt = await callAPI(csv, result.data.length, cols, ctx);
          setReport(rpt); setMode("report");
        } catch (e) {
          setErr("Generation failed: " + e.message);
          setChatHistory(prev => [...prev, { role: "ai", text: "Something went wrong — try Generate again." }]);
        } finally { setLoading(false); }
        return;
      }
    }
    setUserContext(prev => (prev + " " + msg).trim());
    setChatHistory(prev => [...prev, {
      role: "ai",
      text: pdfB64 || data
        ? "Noted. Hit Generate when ready, or keep adding detail."
        : "Got it. Paste data, attach your assignment brief (📄) or dataset (📊), or keep describing — then hit Generate."
    }]);
  };

  const chatGenerate = () => {
    const ctx = chatHistory.filter(m => m.role === "user").map(m => m.text).join(" ");
    generate(ctx);
  };

  const reset = () => {
    setMode("home"); setData(null); setColumns([]); setReport(null); setLabel("");
    setChatHistory([]); setUserContext(""); setErr(null); setPdfB64(null); setPdfName(""); setDiscipline("auto");
  };

  const numericCols = data ? columns.filter(c => typeof data[0][c] === "number") : [];

  // Downsample large datasets for smooth chart rendering
  const chartData = data && data.length > 300
    ? data.filter((_, i) => i % Math.ceil(data.length / 300) === 0)
    : data;

  // ── Export helpers ────────────────────────────────────────────────────
  const reportToMarkdown = () => {
    if (!report) return "";
    let md = `# ${report.title}\n\n> ${report.summary || ""}\n\n`;
    for (const s of report.sections || []) md += `## ${s.heading}\n\n${s.content}\n\n`;
    if ((report.key_figures || []).length) {
      md += `## Key Figures\n\n`;
      for (const k of report.key_figures) md += `- **${k.name}**: ${k.value} — ${k.meaning}\n`;
    }
    md += `\n---\n*Draft generated by AssignmentAI — verify content and cite sources properly.*\n`;
    return md;
  };

  const [copied, setCopied] = useState(false);
  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportToMarkdown());
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch { setErr("Copy failed — select the text manually."); }
  };

  const downloadReport = () => {
    const blob = new Blob([reportToMarkdown()], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (report?.title || "report").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60) + ".md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const printReport = () => window.print();

  const wordCount = report
    ? (report.sections || []).reduce((n, s) => n + (s.content || "").split(/\s+/).filter(Boolean).length, 0)
    : 0;

  return (
    <div style={S.root}>
      <style>{CSS}</style>

      <nav style={S.nav} className="fade-in">
        <div style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }} onClick={reset}>
          <div style={S.logoMark}>✦</div>
          <span style={S.logoText}>Assignment<span style={{ color: "#2563eb" }}>AI</span></span>
        </div>
        {mode !== "home" && <button onClick={reset} style={S.navBtn} className="hover-lift">← Start over</button>}
      </nav>

      <main style={S.main}>
        {err && <div style={S.err} className="slide-up">{err}</div>}

        {/* ── HOME ─────────────────────────────────── */}
        {mode === "home" && (
          <div style={{ maxWidth: 620, margin: "0 auto" }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (!f) return;
              if (f.name.endsWith(".csv")) handleCSVFile(f);
              else if (f.name.endsWith(".pdf")) handlePDFFile(f);
              else setErr("Drop a .csv or .pdf file");
            }}>
            <div style={{ textAlign: "center", margin: "34px 0 36px" }} className="slide-up">
              <h1 style={S.hero}>Your assignment brief.<br />A full draft report.</h1>
              <p style={S.sub}>Physics labs, business reports, legal memos, econ analysis — upload the brief, get a structured draft to work from.</p>
            </div>

            {/* Discipline picker */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "center", marginBottom: 30 }} className="slide-up-delay-1">
              {DISCIPLINES.map(d => (
                <button key={d.id} onClick={() => setDiscipline(d.id)}
                  style={{ ...S.discChip, ...(discipline === d.id ? S.discChipActive : {}) }} className="hover-lift">
                  {d.icon} {d.label}
                </button>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 34 }} className="slide-up-delay-2">
              <ModeCard icon="📄" title="Assignment brief" sub="Upload PDF" onClick={() => pdfRef.current?.click()} />
              <ModeCard icon="💬" title="Describe it" sub="Chat with the AI" onClick={() => setMode("chat")} />
              <ModeCard icon="📊" title="Upload data" sub="CSV dataset" onClick={() => csvRef.current?.click()} />
              <input ref={csvRef} type="file" accept=".csv" style={{ display: "none" }}
                onChange={e => e.target.files[0] && handleCSVFile(e.target.files[0])} />
              <input ref={pdfRef} type="file" accept=".pdf" style={{ display: "none" }}
                onChange={e => e.target.files[0] && handlePDFFile(e.target.files[0])} />
            </div>

            <div className="slide-up-delay-3">
              <p style={S.sectionLabel}>TRY A SAMPLE DATASET</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {SAMPLES.map(s => (
                  <button key={s.name} onClick={() => loadSample(s)} style={S.sampleBtn} className="hover-lift">
                    <span style={S.tag}>{s.tag}</span>{s.name}
                  </button>
                ))}
              </div>
            </div>

            <p style={{ textAlign: "center", fontSize: 11, color: "#c4c4c8", marginTop: 40 }} className="slide-up-delay-3">
              Drafts are study references — always check against your own understanding and cite properly.
            </p>
          </div>
        )}

        {/* ── CHAT ─────────────────────────────────── */}
        {mode === "chat" && (
          <div style={{ maxWidth: 620, margin: "0 auto", display: "flex", flexDirection: "column", height: "calc(100vh - 150px)" }} className="fade-in">
            {(pdfName || data) && (
              <div style={S.attachBar} className="slide-up">
                {pdfName && <span style={S.attachChip}>📄 {pdfName}</span>}
                {data && <span style={S.attachChip}>📊 {label} ({data.length} rows)</span>}
                <button onClick={chatGenerate} disabled={loading} style={S.miniGen} className="hover-lift">
                  {loading ? "Generating..." : "Generate →"}
                </button>
              </div>
            )}

            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
              {chatHistory.length === 0 && (
                <div style={{ textAlign: "center", padding: "52px 24px", color: "#a3a3a3" }} className="fade-in">
                  <div style={{ fontSize: 26, marginBottom: 12, opacity: 0.45 }}>💬</div>
                  <p style={{ fontSize: 15, marginBottom: 6, color: "#666" }}>Describe your assignment</p>
                  <p style={{ fontSize: 12.5, lineHeight: 1.65 }}>
                    "Marketing report on Tesla's entry into Southeast Asia..."<br />
                    "Legal memo on breach of contract under UK law..."<br />
                    "Lab report — I measured muon decay times..."
                  </p>
                </div>
              )}
              {chatHistory.map((m, i) => (
                <div key={i} className="msg-in" style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 10 }}>
                  <div style={{
                    maxWidth: "82%", padding: "10px 15px", fontSize: 13.5, lineHeight: 1.55,
                    background: m.role === "user" ? "#111" : "#f4f4f5",
                    color: m.role === "user" ? "#fff" : "#333",
                    borderRadius: 16,
                    borderBottomRightRadius: m.role === "user" ? 5 : 16,
                    borderBottomLeftRadius: m.role === "ai" ? 5 : 16,
                    whiteSpace: "pre-wrap"
                  }}>{m.text}</div>
                </div>
              ))}
              {loading && (
                <div className="msg-in" style={{ display: "flex", marginBottom: 10 }}>
                  <div style={{ padding: "13px 16px", borderRadius: 16, borderBottomLeftRadius: 5, background: "#f4f4f5" }}>
                    <TypingDots />
                  </div>
                </div>
              )}
              <div ref={chatEnd} />
            </div>

            <div style={{ display: "flex", gap: 8, paddingTop: 12 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => chatPdfRef.current?.click()} style={S.iconBtn} className="hover-lift" title="Attach brief PDF">📄</button>
                <button onClick={() => chatCsvRef.current?.click()} style={S.iconBtn} className="hover-lift" title="Attach CSV">📊</button>
                <input ref={chatCsvRef} type="file" accept=".csv" style={{ display: "none" }}
                  onChange={e => { if (e.target.files[0]) { handleCSVFile(e.target.files[0], false); setChatHistory(p => [...p, { role: "ai", text: `📊 ${e.target.files[0].name} loaded. Describe the task or hit Generate.` }]); } }} />
                <input ref={chatPdfRef} type="file" accept=".pdf" style={{ display: "none" }}
                  onChange={e => { if (e.target.files[0]) { handlePDFFile(e.target.files[0]); setChatHistory(p => [...p, { role: "ai", text: `📄 ${e.target.files[0].name} attached — I'll follow its structure and answer its tasks. Add anything else or hit Generate.` }]); } }} />
              </div>
              <textarea
                value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                placeholder="Describe your assignment or paste data..."
                rows={2} style={S.chatInput}
              />
              <button onClick={sendChat} disabled={loading || !chatInput.trim()}
                style={{ ...S.sendBtn, opacity: (!chatInput.trim() || loading) ? 0.35 : 1 }} className="hover-lift">↑</button>
            </div>
          </div>
        )}

        {/* ── PREVIEW ──────────────────────────────── */}
        {mode === "preview" && (data || pdfB64) && (
          <div style={{ maxWidth: 700, margin: "0 auto" }} className="fade-in">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }} className="slide-up">
              <div>
                <h2 style={{ fontSize: 19, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>{label || pdfName || "Ready"}</h2>
                <p style={{ fontSize: 12.5, color: "#999", margin: "5px 0 0" }}>
                  {data ? `${data.length} rows · ${columns.length} columns` : ""}
                  {data && pdfName ? "  ·  " : ""}{pdfName ? `📄 ${pdfName}` : ""}
                </p>
              </div>
              <button onClick={() => generate()} disabled={loading} style={S.genBtn} className="hover-lift">
                {loading ? "Generating..." : "Generate draft →"}
              </button>
            </div>

            {/* Discipline strip */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }} className="slide-up">
              {DISCIPLINES.map(d => (
                <button key={d.id} onClick={() => setDiscipline(d.id)}
                  style={{ ...S.discChipSm, ...(discipline === d.id ? S.discChipActive : {}) }}>
                  {d.icon} {d.label}
                </button>
              ))}
            </div>

            <div style={{ ...S.card, marginBottom: 14 }} className="slide-up-delay-1">
              <input value={userContext} onChange={e => setUserContext(e.target.value)}
                placeholder="Optional context — module name, word count, specific frameworks to use..."
                style={S.contextInput} />
            </div>

            {data && numericCols.length >= 2 && (
              <div style={S.card} className="slide-up-delay-1">
                <ResponsiveContainer width="100%" height={220}>
                  <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey={numericCols[0]} tick={{ fontSize: 10, fill: "#aaa" }} stroke="#e5e5e5" />
                    <YAxis dataKey={numericCols[1]} tick={{ fontSize: 10, fill: "#aaa" }} stroke="#e5e5e5" />
                    <Tooltip contentStyle={S.tooltip} />
                    <Scatter data={chartData} fill="#2563eb" r={2} opacity={0.55} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}

            {data && (
              <div style={{ ...S.card, padding: 0, overflow: "hidden" }} className="slide-up-delay-2">
                <div style={{ overflowX: "auto", maxHeight: 220 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr>{columns.map(c => <th key={c} style={S.th}>{c}</th>)}</tr></thead>
                    <tbody>
                      {data.slice(0, 10).map((r, i) => (
                        <tr key={i} className="row-hover">{columns.map(c => <td key={c} style={S.td}>{String(r[c])}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.length > 10 && <div style={S.tableFoot}>+{data.length - 10} more rows</div>}
              </div>
            )}

            {!data && pdfB64 && (
              <div style={{ ...S.card, textAlign: "center", padding: 38 }} className="slide-up-delay-1">
                <div style={{ fontSize: 30, marginBottom: 10 }}>📄</div>
                <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px" }}>{pdfName}</p>
                <p style={{ fontSize: 12, color: "#999", margin: 0 }}>Draft will follow this brief. Optionally add data:</p>
                <button onClick={() => csvRef.current?.click()} style={{ ...S.sampleBtn, margin: "14px auto 0" }} className="hover-lift">📊 Add data file</button>
                <input ref={csvRef} type="file" accept=".csv" style={{ display: "none" }}
                  onChange={e => e.target.files[0] && handleCSVFile(e.target.files[0])} />
              </div>
            )}

            {loading && <LoadingBlock hasData={!!data} />}
          </div>
        )}

        {/* ── REPORT ───────────────────────────────── */}
        {mode === "report" && report && (
          <div style={{ maxWidth: 700, margin: "0 auto" }}>
            <div style={{ marginBottom: 28, paddingBottom: 22, borderBottom: "1px solid #f0f0f0" }} className="slide-up">
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <p style={{ fontSize: 10.5, color: "#2563eb", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 8, textTransform: "uppercase" }}>
                  {report.discipline || "Draft"} · Draft Report · {wordCount.toLocaleString()} words
                </p>
                <div style={{ display: "flex", gap: 6 }} className="no-print">
                  <button onClick={copyReport} style={S.toolBtn} className="hover-lift" title="Copy as markdown">
                    {copied ? "✓ Copied" : "Copy"}
                  </button>
                  <button onClick={downloadReport} style={S.toolBtn} className="hover-lift" title="Download .md">Download</button>
                  <button onClick={printReport} style={S.toolBtn} className="hover-lift" title="Print / Save as PDF">Print</button>
                  <button onClick={() => generate()} disabled={loading} style={S.toolBtn} className="hover-lift" title="Regenerate">
                    {loading ? "..." : "↻ Redo"}
                  </button>
                </div>
              </div>
              <h1 style={{ fontSize: 25, fontWeight: 700, margin: "0 0 12px", lineHeight: 1.25, letterSpacing: "-0.02em", color: "#0a0a0a" }}>{report.title}</h1>
              {report.summary && <div style={S.finding}>{report.summary}</div>}
            </div>

            {(report.sections || []).map((sec, i) => (
              <div key={i} className={i < 3 ? "slide-up-delay-1" : "slide-up-delay-2"} style={{ marginBottom: 26 }}>
                <h3 style={S.secHead}>{sec.heading}</h3>
                <p style={S.secBody}>{sec.content}</p>

                {/* Insert chart after second section if available */}
                {i === 1 && data && report.chart && report.chart.x_col && (
                  <div style={{ ...S.card, marginTop: 18 }}>
                    <p style={S.cardLabel}>{report.chart.caption || "Data"}</p>
                    <ResponsiveContainer width="100%" height={280}>
                      <ScatterChart margin={{ top: 8, right: 16, bottom: 30, left: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey={report.chart.x_col} tick={{ fontSize: 10, fill: "#aaa" }} stroke="#e5e5e5"
                          label={{ value: report.chart.x_label, position: "bottom", offset: 14, fontSize: 11, fill: "#777" }} />
                        <YAxis dataKey={report.chart.y_col} tick={{ fontSize: 10, fill: "#aaa" }} stroke="#e5e5e5"
                          label={{ value: report.chart.y_label, angle: -90, position: "insideLeft", offset: 0, fontSize: 11, fill: "#777" }} />
                        <Tooltip contentStyle={S.tooltip} />
                        <Scatter data={chartData} fill="#2563eb" r={2.5} opacity={0.5} />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            ))}

            {(report.key_figures || []).length > 0 && (
              <div style={{ ...S.card, marginBottom: 26 }} className="slide-up-delay-2">
                <p style={S.cardLabel}>Key Figures</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))", gap: 10 }}>
                  {report.key_figures.map((p, i) => (
                    <div key={i} style={S.paramCard} className="hover-lift">
                      <div style={{ fontSize: 17, fontWeight: 700, color: "#2563eb" }}>{p.value}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#333", marginTop: 3 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "#999", marginTop: 5, lineHeight: 1.45 }}>{p.meaning}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ textAlign: "center", padding: "28px 0 8px", color: "#c4c4c8", fontSize: 11, lineHeight: 1.7 }}>
              Draft generated by AssignmentAI · OpenAI Build Week 2026<br />
              Use as a study reference — verify content and cite sources properly.
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ── Components ───────────────────────────────────────────────────────────
function ModeCard({ icon, title, sub, onClick }) {
  return (
    <button onClick={onClick} style={S.modeCard} className="hover-lift">
      <span style={{ fontSize: 22 }}>{icon}</span>
      <span style={{ fontWeight: 600, fontSize: 13.5, color: "#111" }}>{title}</span>
      <span style={{ fontSize: 11, color: "#999" }}>{sub}</span>
    </button>
  );
}

function TypingDots() {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", height: 10 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#a3a3a3", animation: `bounce 1.2s ${i * 0.15}s infinite ease-in-out` }} />
      ))}
    </div>
  );
}

function LoadingBlock({ hasData }) {
  const steps = hasData
    ? ["Reading data structure", "Detecting discipline & task", "Running analysis", "Writing sections", "Polishing draft"]
    : ["Reading the brief", "Detecting discipline & required structure", "Addressing each task", "Writing sections", "Polishing draft"];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx(i => Math.min(i + 1, steps.length - 1)), 2400);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ textAlign: "center", padding: "42px 20px" }} className="fade-in">
      <div style={S.spinner} />
      <p style={{ fontSize: 13, color: "#666", marginTop: 18, fontWeight: 500 }} key={idx} className="fade-in">{steps[idx]}</p>
    </div>
  );
}

// ── CSS ──────────────────────────────────────────────────────────────────
const CSS = `
@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes slideUp { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: translateY(0) } }
@keyframes msgIn { from { opacity: 0; transform: translateY(8px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }
@keyframes spin { to { transform: rotate(360deg) } }
@keyframes bounce { 0%, 60%, 100% { transform: translateY(0) } 30% { transform: translateY(-5px) } }
.fade-in { animation: fadeIn 0.5s ease both }
.slide-up { animation: slideUp 0.45s cubic-bezier(0.16,1,0.3,1) both }
.slide-up-delay-1 { animation: slideUp 0.45s 0.08s cubic-bezier(0.16,1,0.3,1) both }
.slide-up-delay-2 { animation: slideUp 0.45s 0.16s cubic-bezier(0.16,1,0.3,1) both }
.slide-up-delay-3 { animation: slideUp 0.45s 0.24s cubic-bezier(0.16,1,0.3,1) both }
.msg-in { animation: msgIn 0.3s cubic-bezier(0.16,1,0.3,1) both }
.hover-lift { transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease }
.hover-lift:hover { transform: translateY(-1.5px); box-shadow: 0 4px 14px rgba(0,0,0,0.06) }
.row-hover:hover td { background: #fafafa }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important } }
@media print {
  nav, .no-print { display: none !important }
  main { padding: 0 !important }
  * { animation: none !important }
}
`;

// ── Styles ───────────────────────────────────────────────────────────────
const S = {
  root: { minHeight: "100vh", background: "#fff", color: "#111", fontFamily: "'Inter',-apple-system,system-ui,sans-serif", WebkitFontSmoothing: "antialiased" },
  nav: { padding: "15px 26px", borderBottom: "1px solid #f4f4f5", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "rgba(255,255,255,0.88)", backdropFilter: "blur(12px)", zIndex: 10 },
  logoMark: { width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#2563eb,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#fff" },
  logoText: { fontSize: 15, fontWeight: 700, letterSpacing: "-0.03em" },
  navBtn: { background: "#fff", border: "1px solid #e4e4e7", padding: "7px 15px", borderRadius: 9, fontSize: 12, cursor: "pointer", color: "#555", fontWeight: 500 },
  main: { padding: "26px 20px 60px", maxWidth: 960, margin: "0 auto" },
  err: { background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 11, padding: "11px 16px", fontSize: 13, color: "#dc2626", maxWidth: 700, margin: "0 auto 18px" },
  hero: { fontSize: 33, fontWeight: 750, lineHeight: 1.16, letterSpacing: "-0.035em", color: "#0a0a0a", marginBottom: 12 },
  sub: { fontSize: 14.5, color: "#8a8a93", margin: "0 auto", lineHeight: 1.55, maxWidth: 460 },
  sectionLabel: { fontSize: 10.5, color: "#a3a3a3", marginBottom: 11, letterSpacing: "0.09em", fontWeight: 700 },
  discChip: { background: "#fff", border: "1px solid #ececf0", borderRadius: 20, padding: "7px 13px", fontSize: 12, cursor: "pointer", color: "#52525b", fontWeight: 500 },
  discChipSm: { background: "#fff", border: "1px solid #ececf0", borderRadius: 16, padding: "5px 11px", fontSize: 11, cursor: "pointer", color: "#52525b", fontWeight: 500 },
  discChipActive: { background: "#111", color: "#fff", borderColor: "#111" },
  modeCard: { display: "flex", flexDirection: "column", alignItems: "center", gap: 7, padding: "22px 12px", background: "#fff", border: "1px solid #ececf0", borderRadius: 14, cursor: "pointer" },
  sampleBtn: { background: "#fff", border: "1px solid #ececf0", borderRadius: 22, padding: "7px 14px 7px 8px", fontSize: 12.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, color: "#52525b", fontWeight: 500 },
  tag: { fontSize: 9, background: "#eff6ff", color: "#2563eb", padding: "3px 7px", borderRadius: 12, fontWeight: 700 },
  attachBar: { display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 12, marginBottom: 12, flexWrap: "wrap" },
  attachChip: { fontSize: 11.5, background: "#fff", border: "1px solid #e4e4e7", borderRadius: 8, padding: "5px 10px", color: "#555", fontWeight: 500 },
  miniGen: { marginLeft: "auto", background: "#111", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  iconBtn: { width: 42, height: 42, borderRadius: 11, border: "1px solid #ececf0", background: "#fff", fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", alignSelf: "flex-end" },
  chatInput: { flex: 1, border: "1px solid #e4e4e7", borderRadius: 13, padding: "11px 15px", fontSize: 13.5, resize: "none", outline: "none", fontFamily: "inherit", lineHeight: 1.5, color: "#111" },
  sendBtn: { width: 42, height: 42, borderRadius: 11, border: "none", background: "#111", color: "#fff", fontSize: 17, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", alignSelf: "flex-end", fontWeight: 700 },
  card: { background: "#fff", border: "1px solid #f0f0f2", borderRadius: 14, padding: 20, marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.02)" },
  cardLabel: { fontSize: 10.5, color: "#a3a3a3", fontWeight: 700, letterSpacing: "0.07em", marginBottom: 13, marginTop: 0, textTransform: "uppercase" },
  contextInput: { width: "100%", border: "none", outline: "none", fontSize: 13, color: "#333", fontFamily: "inherit", background: "transparent" },
  genBtn: { background: "#111", border: "none", color: "#fff", padding: "11px 22px", borderRadius: 11, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  toolBtn: { background: "#fff", border: "1px solid #e4e4e7", borderRadius: 8, padding: "6px 12px", fontSize: 11.5, cursor: "pointer", color: "#52525b", fontWeight: 600 },
  th: { padding: "10px 15px", textAlign: "left", borderBottom: "1px solid #f4f4f5", color: "#a3a3a3", fontWeight: 700, fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.06em", position: "sticky", top: 0, background: "#fff" },
  td: { padding: "8px 15px", borderBottom: "1px solid #fafafa", color: "#52525b", fontFamily: "'SF Mono','Fira Code',monospace", fontSize: 11.5 },
  tableFoot: { padding: "9px 16px", fontSize: 11, color: "#b3b3b3", borderTop: "1px solid #f4f4f5" },
  finding: { display: "inline-block", background: "#eff6ff", borderRadius: 9, padding: "7px 15px", fontSize: 13, color: "#2563eb", fontWeight: 600 },
  secHead: { fontSize: 15, fontWeight: 700, color: "#18181b", letterSpacing: "-0.015em", marginBottom: 9, marginTop: 0 },
  secBody: { fontSize: 14, lineHeight: 1.85, color: "#3f3f46", margin: 0, whiteSpace: "pre-wrap" },
  paramCard: { background: "#fafafa", borderRadius: 11, padding: "13px 15px", border: "1px solid #f4f4f5" },
  spinner: { width: 30, height: 30, border: "2.5px solid #f0f0f0", borderTopColor: "#2563eb", borderRadius: "50%", margin: "0 auto", animation: "spin 0.65s linear infinite" },
  tooltip: { borderRadius: 9, fontSize: 11, border: "1px solid #f0f0f0", boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }
};
