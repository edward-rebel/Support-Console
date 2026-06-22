import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type {
  KnowledgeBuildStatus,
  KnowledgeEntryDTO,
  KnowledgeEntryType,
} from "@ms/shared";
import { CATEGORIES } from "@ms/shared";

const TYPE_TABS: { key: KnowledgeEntryType; label: string }[] = [
  { key: "canonical", label: "Canonical answers" },
  { key: "policy", label: "Policies" },
  { key: "example", label: "Examples" },
];

const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: "20px 22px",
  boxShadow: "var(--shadow)",
  marginBottom: 18,
};

export function Knowledge() {
  const [status, setStatus] = useState<KnowledgeBuildStatus | null>(null);
  const [tab, setTab] = useState<KnowledgeEntryType>("canonical");
  const [category, setCategory] = useState<string>("");
  const [entries, setEntries] = useState<KnowledgeEntryDTO[]>([]);
  const [tone, setTone] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStatus = () =>
    api.knowledgeStatus().then(setStatus).catch(() => setStatus(null));
  const loadEntries = () =>
    api
      .listKnowledge({ type: tab, category: category || undefined })
      .then(setEntries)
      .catch(() => setEntries([]));
  const loadTone = () =>
    api
      .getTone()
      .then((t) => setTone(t?.content ?? null))
      .catch(() => setTone(null));

  useEffect(() => {
    void loadStatus();
    void loadTone();
  }, []);
  useEffect(() => {
    void loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, category]);

  // Poll while a build is running, then refresh everything once it finishes.
  useEffect(() => {
    if (status?.running && !pollRef.current) {
      pollRef.current = setInterval(() => void loadStatus(), 1500);
    } else if (!status?.running && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      void loadEntries();
      void loadTone();
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.running]);

  const build = async () => {
    try {
      const r = await api.buildKnowledge();
      setStatus(r);
    } catch {
      /* surfaced via status.lastError on next poll */
    }
  };

  const counts = status?.counts;
  const hasAny =
    (counts?.canonical ?? 0) + (counts?.example ?? 0) + (counts?.policy ?? 0) > 0;

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "24px 32px 40px" }}>
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <div style={{ marginBottom: 22 }}>
          <h1 style={{ margin: "0 0 3px", fontSize: 21, fontWeight: 700, letterSpacing: "-0.015em" }}>
            Knowledge Base
          </h1>
          <div style={{ fontSize: 13.5, color: "var(--text-3)" }}>
            What the AI draws from when it writes a reply — mined from your real support history.
          </div>
        </div>

        {/* Build / status card */}
        <div style={card}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 4 }}>
                Build from history
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.5 }}>
                Mines question→answer pairs from past customer threads, distills canonical
                answers, policies and a tone profile, then embeds them for retrieval. Safe to
                re-run; it never sends email.
              </div>
            </div>
            <button
              onClick={() => void build()}
              disabled={status?.running || !status?.configured}
              style={{
                cursor: status?.running || !status?.configured ? "default" : "pointer",
                fontSize: 13,
                fontWeight: 600,
                padding: "9px 16px",
                borderRadius: 9,
                border: "none",
                background: "var(--accent)",
                color: "var(--accent-fg)",
                opacity: status?.running || !status?.configured ? 0.55 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {status?.running
                ? `Building… ${status.stage ?? ""}`
                : hasAny
                  ? "Rebuild knowledge base"
                  : "Build knowledge base"}
            </button>
          </div>

          {!status?.configured && (
            <div
              style={{
                marginTop: 14,
                padding: "10px 14px",
                borderRadius: 10,
                fontSize: 12.5,
                background: "var(--warn-bg)",
                color: "var(--warn-tx)",
                border: "1px solid var(--warn-bd)",
              }}
            >
              No embeddings provider configured. Set <code>OPENAI_API_KEY</code> (or{" "}
              <code>EMBEDDINGS_API_KEY</code>) to enable building.
            </div>
          )}

          {counts && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
              <CountPill label="Canonical" n={counts.canonical} />
              <CountPill label="Policies" n={counts.policy} />
              <CountPill label="Examples" n={counts.example} />
              <CountPill label="Tone profile" n={status?.hasTone ? 1 : 0} />
              {counts.unembedded > 0 && (
                <CountPill label="Awaiting embedding" n={counts.unembedded} warn />
              )}
            </div>
          )}

          {status?.lastError && (
            <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--warn-tx)" }}>
              {status.lastError}
            </div>
          )}
          {status?.lastResult && !status.running && (
            <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--text-3)" }}>
              Last build: {status.lastResult.examplesMined} examples mined ·{" "}
              {status.lastResult.canonicalsWritten} canonical ·{" "}
              {status.lastResult.policiesWritten} policies ·{" "}
              {status.lastResult.entriesEmbedded} embedded.
            </div>
          )}
        </div>

        {/* Tone profile */}
        <ToneCard content={tone} onSaved={loadTone} />

        {/* Entries */}
        <div style={card}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 16,
            }}
          >
            <div style={{ display: "flex", gap: 4 }}>
              {TYPE_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{
                    cursor: "pointer",
                    fontSize: 12.5,
                    fontWeight: 600,
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: tab === t.key ? "var(--accent-soft-bg)" : "transparent",
                    color: tab === t.key ? "var(--accent-soft-fg)" : "var(--text-2)",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{
                marginLeft: "auto",
                height: 32,
                padding: "0 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text-2)",
                fontSize: 12.5,
              }}
            >
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <AddEntryForm type={tab} defaultCategory={category} onAdded={loadEntries} />

          {entries.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-3)", padding: "20px 0" }}>
              {tab === "example"
                ? "No examples yet. Run a build to mine them from your history."
                : `No ${tab} entries yet. Build the knowledge base or add one above.`}
            </div>
          ) : (
            entries.map((e) => (
              <EntryRow key={e.id} entry={e} onChanged={loadEntries} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function CountPill({ label, n, warn }: { label: string; n: number; warn?: boolean }) {
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        padding: "5px 11px",
        borderRadius: 999,
        background: warn ? "var(--warn-bg)" : "var(--surface-2)",
        color: warn ? "var(--warn-tx)" : "var(--text-2)",
        border: "1px solid var(--border)",
      }}
    >
      {label}: {n}
    </span>
  );
}

function categoryChip(slug: string | undefined, name: string | undefined) {
  if (!slug || !name) return null;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 9px",
        borderRadius: 999,
        background: `var(--cat-${slug}-bg)`,
        color: `var(--cat-${slug}-fg)`,
      }}
    >
      {name}
    </span>
  );
}

function ToneCard({ content, onSaved }: { content: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const startEdit = () => {
    setDraft(content ?? "");
    setEditing(true);
  };
  const save = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await api.saveTone(draft);
      setEditing(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 15.5, fontWeight: 700 }}>Tone profile</div>
        <button
          onClick={editing ? () => setEditing(false) : startEdit}
          style={{
            marginLeft: "auto",
            cursor: "pointer",
            fontSize: 12.5,
            fontWeight: 600,
            padding: "6px 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-2)",
          }}
        >
          {editing ? "Cancel" : content ? "Edit" : "Write manually"}
        </button>
      </div>
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={10}
            style={textareaStyle}
          />
          <button onClick={() => void save()} disabled={busy} style={primaryBtn}>
            Save tone profile
          </button>
        </>
      ) : content ? (
        <div
          style={{
            fontSize: 13,
            color: "var(--text-2)",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {content}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: "var(--text-3)" }}>
          No tone profile yet. Build the knowledge base to derive one from your replies, or
          write one manually.
        </div>
      )}
    </div>
  );
}

function AddEntryForm({
  type,
  defaultCategory,
  onAdded,
}: {
  type: KnowledgeEntryType;
  defaultCategory: string;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [cat, setCat] = useState(defaultCategory);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!answer.trim() || busy) return;
    setBusy(true);
    try {
      await api.createKnowledge({
        type,
        categorySlug: cat || undefined,
        question: type === "policy" ? undefined : question || undefined,
        answer,
      });
      setQuestion("");
      setAnswer("");
      setOpen(false);
      onAdded();
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => {
          setCat(defaultCategory);
          setOpen(true);
        }}
        style={{
          cursor: "pointer",
          fontSize: 12.5,
          fontWeight: 600,
          padding: "7px 13px",
          borderRadius: 8,
          border: "1px dashed var(--border)",
          background: "transparent",
          color: "var(--text-2)",
          marginBottom: 16,
        }}
      >
        + Add {type === "policy" ? "policy" : type === "canonical" ? "canonical answer" : "example"}
      </button>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 14,
        marginBottom: 16,
        background: "var(--surface-2)",
      }}
    >
      {type !== "policy" && (
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Customer question"
          style={{ ...textareaStyle, height: 36, marginBottom: 8 }}
        />
      )}
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={4}
        placeholder={type === "policy" ? "Policy statement" : "Answer"}
        style={textareaStyle}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          style={{
            height: 34,
            padding: "0 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text-2)",
            fontSize: 12.5,
          }}
        >
          <option value="">No category</option>
          {CATEGORIES.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <button onClick={() => void submit()} disabled={busy} style={primaryBtn}>
          Save
        </button>
        <button
          onClick={() => setOpen(false)}
          style={{
            cursor: "pointer",
            fontSize: 12.5,
            fontWeight: 600,
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-2)",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function EntryRow({ entry, onChanged }: { entry: KnowledgeEntryDTO; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(entry.question ?? "");
  const [answer, setAnswer] = useState(entry.answer);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!answer.trim() || busy) return;
    setBusy(true);
    try {
      await api.updateKnowledge(entry.id, {
        question: entry.type === "policy" ? undefined : question,
        answer,
      });
      setEditing(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.deleteKnowledge(entry.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        borderTop: "1px solid var(--border-2)",
        padding: "14px 0",
        opacity: entry.isActive ? 1 : 0.55,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {categoryChip(entry.category?.slug, entry.category?.name)}
        {!entry.embedded && (
          <span style={{ fontSize: 11, color: "var(--warn-tx)", fontWeight: 600 }}>
            not embedded
          </span>
        )}
        {entry.sourceThreadId && (
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>from history</span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={editing ? () => setEditing(false) : () => setEditing(true)} style={miniBtn}>
            {editing ? "Cancel" : "Edit"}
          </button>
          <button onClick={() => void remove()} style={miniBtn}>
            Delete
          </button>
        </div>
      </div>

      {editing ? (
        <>
          {entry.type !== "policy" && (
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Question"
              style={{ ...textareaStyle, height: 36, marginBottom: 8 }}
            />
          )}
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={4}
            style={textareaStyle}
          />
          <button onClick={() => void save()} disabled={busy} style={primaryBtn}>
            Save
          </button>
        </>
      ) : (
        <>
          {entry.question && (
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 3 }}>
              {entry.question}
            </div>
          )}
          <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
            {entry.answer}
          </div>
        </>
      )}
    </div>
  );
}

const textareaStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 12px",
  borderRadius: 9,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: 13,
  fontFamily: "var(--sans)",
  lineHeight: 1.5,
  resize: "vertical",
  marginBottom: 10,
};

const primaryBtn: React.CSSProperties = {
  cursor: "pointer",
  fontSize: 12.5,
  fontWeight: 600,
  padding: "8px 16px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-fg)",
};

const miniBtn: React.CSSProperties = {
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  padding: "4px 10px",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-3)",
};
