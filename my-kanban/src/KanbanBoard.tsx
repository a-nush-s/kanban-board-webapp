// KanbanBoard.tsx
// Dependencies: npm install @supabase/supabase-js
// Setup:
//   1. Supabase Dashboard → Authentication → Providers → Anonymous → Enable
//   2. Run supabase_schema.sql in the SQL Editor

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient, Session } from "@supabase/supabase-js";

// ─── Supabase client ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://lbmmpljxesxfjwkencjj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxibW1wbGp4ZXN4Zmp3a2VuY2pqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MTQ0MzIsImV4cCI6MjA5MDQ5MDQzMn0.oRmLD06yYzyPhuZbXjiBR_MbTrIkCJMvI2W3lvcl-Z4";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Types ────────────────────────────────────────────────────────────────────
type Status   = "todo" | "in_progress" | "in_review" | "done";
type Priority = "low" | "normal" | "high";

interface Profile {
  user_id:      string;
  display_name: string;
  avatar_url:   string | null;
}

interface Team {
  id:         string;
  name:       string;
  created_by: string;
}

interface TeamMember {
  team_id: string;
  user_id: string;
  profile: Profile;
}

interface Task {
  id:          string;
  title:       string;
  status:      Status;
  user_id:     string;
  created_at:  string;
  description: string;
  priority:    Priority;
  due_date:    string | null;
  team_id:     string | null;
}

interface TaskAssignee {
  task_id: string;
  user_id: string;
}

type NewTaskFields = Pick<Task, "title" | "description" | "priority" | "due_date" | "team_id"> & {
  assignee_ids: string[];
};

interface Column {
  id:     Status;
  label:  string;
  color:  string;
  accent: string;
}

// ─── Static config ────────────────────────────────────────────────────────────
const COLUMNS: Column[] = [
  { id: "todo",        label: "To Do",       color: "#f3e7da", accent: "#d3ad81" },
  { id: "in_progress", label: "In Progress", color: "#fffbe0", accent: "#dec957" },
  { id: "in_review",   label: "In Review",   color: "#e1f0ff", accent: "#689dd1" },
  { id: "done",        label: "Done",        color: "#e9ffd8", accent: "#9eca79" },
];

const PRIORITY_META: Record<Priority, { label: string; color: string; bg: string }> = {
  low:    { label: "Low",    color: "#407b10", bg: "#d3f1bc" },
  normal: { label: "Normal", color: "#eec42c", bg: "#f3e7b8" },
  high:   { label: "High",   color: "#991d1d", bg: "#fac6c6" },
};

// Deterministic pastel color from a string (used for avatar fallback)
function avatarColor(str: string): string {
  const colors = ["#CECBF6","#9FE1CB","#F5C4B3","#F4C0D1","#B5D4F4","#C0DD97","#FAC775"];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function initials(name: string): string {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function isOverdue(due: string | null): boolean {
  if (!due) return false;
  return new Date(due) < new Date(new Date().toDateString());
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ profile, size = 28 }: { profile: Profile; size?: number }) {
  const [imgError, setImgError] = useState(false);
  const showImg = profile.avatar_url && !imgError;
  return (
    <div
      title={profile.display_name}
      style={{
        width: size, height: size, borderRadius: "50%",
        background: showImg ? "transparent" : avatarColor(profile.display_name),
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.36, fontWeight: 600,
        color: "#444", overflow: "hidden", flexShrink: 0,
        border: "2px solid #fff",
      }}
    >
      {showImg
        ? <img src={profile.avatar_url!} alt={profile.display_name}
            onError={() => setImgError(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : initials(profile.display_name)
      }
    </div>
  );
}

// ─── Onboarding screen ────────────────────────────────────────────────────────
interface OnboardingProps {
  userId: string;
  onComplete: (profile: Profile) => void;
}

function Onboarding({ userId, onComplete }: OnboardingProps) {
  const [name,        setName]        = useState("");
  const [avatarFile,  setAvatarFile]  = useState<File | null>(null);
  const [preview,     setPreview]     = useState<string | null>(null);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setPreview(URL.createObjectURL(file));
  }

  async function handleSubmit() {
    if (!name.trim()) { setError("Display name is required."); return; }
    setSaving(true);
    setError(null);

    let avatar_url: string | null = null;

    // Upload avatar if provided
    if (avatarFile) {
      const ext  = avatarFile.name.split(".").pop();
      const path = `${userId}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, avatarFile, { upsert: true });

      if (uploadError) {
        setError("Avatar upload failed: " + uploadError.message);
        setSaving(false);
        return;
      }

      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
      // Bust cache so the new image is fetched fresh
      avatar_url = urlData.publicUrl + "?t=" + Date.now();
    }

    // Save profile row
    const { error: profileError } = await supabase
      .from("profiles")
      .insert({ user_id: userId, display_name: name.trim(), avatar_url });

    if (profileError) {
      setError("Could not save profile: " + profileError.message);
      setSaving(false);
      return;
    }

    onComplete({ user_id: userId, display_name: name.trim(), avatar_url });
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", border: "1px solid #ddd",
    borderRadius: 8, padding: "10px 12px", fontSize: 14, outline: "none",
    fontFamily: "''Helvetica Neue', Helvetica, Arial, sans-serif",
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "#f7f6f2",
      fontFamily: "''Helvetica Neue', Helvetica, Arial, sans-serif", padding: 24,
    }}>
      <div style={{
        background: "#fff", borderRadius: 16, padding: 32,
        width: "100%", maxWidth: 400,
        boxShadow: "0 8px 32px rgba(0,0,0,0.10)",
      }}>
        <h1 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700, color: "#1a1a1a" }}>
          Welcome
        </h1>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: "#888" }}>
          Set up your profile to get started.
        </p>

        {/* Avatar picker */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 24, gap: 10 }}>
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              width: 80, height: 80, borderRadius: "50%",
              background: preview ? "transparent" : "#f1efe8",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", overflow: "hidden",
              border: "2px dashed #ccc", fontSize: 28,
            }}
          >
            {preview
              ? <img src={preview} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : "+"
            }
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#185fa5", fontSize: 13 }}
          >
            {preview ? "Change photo" : "Upload profile photo (optional)"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: "none" }} />
        </div>

        {/* Display name */}
        <label style={{ fontSize: 12, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Display name *
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="e.g. Alex Rivera"
          style={{ ...inputStyle, marginTop: 6, marginBottom: 16 }}
          autoFocus
        />

        {error && (
          <p style={{ color: "#993c1d", fontSize: 13, margin: "0 0 12px" }}>{error}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={saving}
          style={{
            width: "100%", background: "#1a1a1a", color: "#fff",
            border: "none", borderRadius: 9, padding: "12px 0",
            cursor: saving ? "default" : "pointer", fontSize: 14,
            fontWeight: 600, opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Get started"}
        </button>
      </div>
    </div>
  );
}

// ─── Team sidebar ─────────────────────────────────────────────────────────────
interface TeamSidebarProps {
  currentUserId: string;
  teams:         Team[];
  members:       TeamMember[];  // all members across all teams the user belongs to
  onCreateTeam:  (name: string) => void;
  onAddMember:   (teamId: string, displayName: string) => void;
  onLeaveTeam:   (teamId: string) => void;
}

function TeamSidebar({ currentUserId, teams, members, onCreateTeam, onAddMember, onLeaveTeam }: TeamSidebarProps) {
  const [newTeamName,   setNewTeamName]   = useState("");
  const [inviteName,    setInviteName]    = useState<Record<string, string>>({});
  const [inviteError,   setInviteError]   = useState<Record<string, string>>({});
  const [expandedTeam,  setExpandedTeam]  = useState<string | null>(null);

  function handleCreateTeam() {
    if (!newTeamName.trim()) return;
    onCreateTeam(newTeamName.trim());
    setNewTeamName("");
  }

  function handleInvite(teamId: string) {
    const name = (inviteName[teamId] ?? "").trim();
    if (!name) return;
    setInviteError((e) => ({ ...e, [teamId]: "" }));
    onAddMember(teamId, name);
    setInviteName((n) => ({ ...n, [teamId]: "" }));
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0",
    borderRadius: 7, padding: "7px 10px", fontSize: 12, outline: "none",
    fontFamily: "''Helvetica Neue', Helvetica, Arial, sans-serif", background: "#fafafa",
  };

  return (
    <div style={{
      width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16,
    }}>
      <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Teams
      </p>

      {/* Team list */}
      {teams.map((team) => {
        const teamMembers = members.filter((m) => m.team_id === team.id);
        const isCreator   = team.created_by === currentUserId;
        const expanded    = expandedTeam === team.id;

        return (
          <div key={team.id} style={{ background: "#fff", borderRadius: 10, border: "0.5px solid #e8e8e8", padding: "12px 14px" }}>
            <div
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", marginBottom: expanded ? 10 : 0 }}
              onClick={() => setExpandedTeam(expanded ? null : team.id)}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>{team.name}</span>
              <span style={{ fontSize: 11, color: "#aaa" }}>{expanded ? "▲" : "▼"}</span>
            </div>

            {expanded && (
              <div>
                {/* Member list */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                  {teamMembers.map((m) => (
                    <div key={m.user_id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Avatar profile={m.profile} size={26} />
                      <span style={{ fontSize: 12, color: "#333", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.profile.display_name}
                        {m.user_id === currentUserId && <span style={{ color: "#aaa" }}> (you)</span>}
                      </span>
                    </div>
                  ))}
                  {teamMembers.length === 0 && (
                    <p style={{ fontSize: 12, color: "#bbb", margin: 0 }}>No members yet.</p>
                  )}
                </div>

                {/* Invite by display name (creator only) */}
                {isCreator && (
                  <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
                    <input
                      value={inviteName[team.id] ?? ""}
                      onChange={(e) => setInviteName((n) => ({ ...n, [team.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && handleInvite(team.id)}
                      placeholder="Add by display name"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button
                      onClick={() => handleInvite(team.id)}
                      style={{
                        background: "#1a1a1a", color: "#fff", border: "none",
                        borderRadius: 7, padding: "0 10px", cursor: "pointer", fontSize: 12,
                      }}
                    >
                      +
                    </button>
                  </div>
                )}
                {inviteError[team.id] && (
                  <p style={{ fontSize: 11, color: "#993c1d", margin: "0 0 6px" }}>{inviteError[team.id]}</p>
                )}

                {/* Leave team */}
                <button
                  onClick={() => onLeaveTeam(team.id)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "#bbb", fontSize: 11, padding: 0,
                  }}
                >
                  {isCreator ? "Delete team" : "Leave team"}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Create new team */}
      <div style={{ background: "#fff", borderRadius: 10, border: "0.5px solid #e8e8e8", padding: "12px 14px" }}>
        <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 600, color: "#555" }}>New team</p>
        <div style={{ display: "flex", gap: 5 }}>
          <input
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateTeam()}
            placeholder="Team name"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={handleCreateTeam}
            style={{
              background: "#1a1a1a", color: "#fff", border: "none",
              borderRadius: 7, padding: "0 10px", cursor: "pointer", fontSize: 13,
            }}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Assignee picker ──────────────────────────────────────────────────────────
interface AssigneePickerProps {
  members:     TeamMember[];
  selected:    string[];  // user_ids
  onChange:    (ids: string[]) => void;
}

function AssigneePicker({ members, selected, onChange }: AssigneePickerProps) {
  if (members.length === 0) {
    return <p style={{ fontSize: 12, color: "#bbb", margin: 0 }}>Join or create a team to assign members.</p>;
  }

  function toggle(userId: string) {
    onChange(selected.includes(userId)
      ? selected.filter((id) => id !== userId)
      : [...selected, userId]);
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {members.map((m) => {
        const active = selected.includes(m.user_id);
        return (
          <button
            key={m.user_id}
            onClick={() => toggle(m.user_id)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: active ? "#1a1a1a" : "#f4f4f4",
              color: active ? "#fff" : "#333",
              border: "none", borderRadius: 99,
              padding: "4px 10px 4px 4px",
              cursor: "pointer", fontSize: 12,
              transition: "background 0.12s",
            }}
          >
            <Avatar profile={m.profile} size={20} />
            {m.profile.display_name}
          </button>
        );
      })}
    </div>
  );
}

// ─── Assignee avatars on card ─────────────────────────────────────────────────
function AssigneeAvatarStack({ userIds, profiles }: { userIds: string[]; profiles: Profile[] }) {
  if (userIds.length === 0) return null;
  const MAX = 3;
  const shown   = userIds.slice(0, MAX);
  const overflow = userIds.length - MAX;

  return (
    <div style={{ display: "flex", marginTop: 10 }}>
      {shown.map((uid, i) => {
        const profile = profiles.find((p) => p.user_id === uid);
        if (!profile) return null;
        return (
          <div key={uid} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: shown.length - i }}>
            <Avatar profile={profile} size={24} />
          </div>
        );
      })}
      {overflow > 0 && (
        <div style={{
          width: 24, height: 24, borderRadius: "50%", background: "#e0e0e0",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 700, color: "#666",
          marginLeft: -8, border: "2px solid #fff",
        }}>
          +{overflow}
        </div>
      )}
    </div>
  );
}

// ─── Priority badge ───────────────────────────────────────────────────────────
function PriorityBadge({ priority }: { priority: Priority }) {
  const { label, color, bg } = PRIORITY_META[priority];
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 99, background: bg, color, letterSpacing: "0.02em" }}>
      {label}
    </span>
  );
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────
interface TaskCardProps {
  task:        Task;
  assigneeIds: string[];
  profiles:    Profile[];
  onDelete:    (id: string) => void;
  onDragStart: (e: React.DragEvent, task: Task) => void;
  onClick:     (task: Task) => void;
}

function TaskCard({ task, assigneeIds, profiles, onDelete, onDragStart, onClick }: TaskCardProps) {
  const overdue = isOverdue(task.due_date);

  return (
    <div
      draggable
      onDragStart={(e) => { e.stopPropagation(); onDragStart(e, task); }}
      onClick={() => onClick(task)}
      style={{
        background: "#fff", border: "0.5px solid rgba(0,0,0,0.10)",
        borderRadius: 10, padding: "12px 14px", marginBottom: 8,
        cursor: "grab", boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        transition: "box-shadow 0.15s, transform 0.15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.10)";
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)";
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
        <p style={{ margin: 0, fontWeight: 500, fontSize: 14, lineHeight: 1.4, color: "#1a1a1a", flex: 1 }}>
          {task.title}
        </p>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#bbb", fontSize: 16, padding: 0, lineHeight: 1 }}
          title="Delete task"
        >×</button>
      </div>

      {task.description && (
        <p style={{ margin: "5px 0 0", fontSize: 12, color: "#999", lineHeight: 1.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {task.description}
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        <PriorityBadge priority={task.priority} />
        {task.due_date && (
          <span style={{
            fontSize: 11, fontWeight: 500, padding: "2px 7px", borderRadius: 99,
            color: overdue ? "#d62121" : "#888",
            background: overdue ? "#fdcfcf" : "#f4f4f4",
          }}>
            {overdue ? "Overdue · " : ""}{formatDate(task.due_date)}
          </span>
        )}
      </div>

      <AssigneeAvatarStack userIds={assigneeIds} profiles={profiles} />
    </div>
  );
}

// ─── Add / Edit Task Form ─────────────────────────────────────────────────────
interface TaskFormProps {
  initial?:  Partial<Task> & { assignee_ids?: string[] };
  status?:   Status;
  accent?:   string;
  teams:     Team[];
  members:   TeamMember[];
  onSubmit:  (fields: NewTaskFields, status: Status) => void;
  onCancel:  () => void;
  onDelete?: () => void;
  submitLabel: string;
}

function TaskForm({ initial, status: initialStatus, accent = "#1a1a1a", teams, members, onSubmit, onCancel, onDelete, submitLabel }: TaskFormProps) {
  const [title,       setTitle]       = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [priority,    setPriority]    = useState<Priority>(initial?.priority ?? "normal");
  const [dueDate,     setDueDate]     = useState(initial?.due_date ?? "");
  const [status,      setStatus]      = useState<Status>(initial?.status ?? initialStatus ?? "todo");
  const [teamId,      setTeamId]      = useState<string>(initial?.team_id ?? "");
  const [assigneeIds, setAssigneeIds] = useState<string[]>(initial?.assignee_ids ?? []);

  const availableMembers = teamId ? members.filter((m) => m.team_id === teamId) : members;

  // When team changes, drop assignees not in the new team
  function handleTeamChange(id: string) {
    setTeamId(id);
    if (id) {
      const validIds = members.filter((m) => m.team_id === id).map((m) => m.user_id);
      setAssigneeIds((prev) => prev.filter((uid) => validIds.includes(uid)));
    }
  }

  function handleSubmit() {
    if (!title.trim()) return;
    onSubmit({
      title:       title.trim(),
      description: description.trim(),
      priority,
      due_date:    dueDate || null,
      team_id:     teamId || null,
      assignee_ids: assigneeIds,
    }, status);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", border: "1px solid #ddd",
    borderRadius: 8, padding: "8px 10px", fontSize: 13, outline: "none",
    fontFamily: "''Helvetica Neue', Helvetica, Arial, sans-serif", background: "#fff",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: "#999",
    textTransform: "uppercase", letterSpacing: "0.05em",
    fontFamily: "''Helvetica Neue', Helvetica, Arial, sans-serif",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={labelStyle}>Title *</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmit()} style={inputStyle} autoFocus />
      </div>
      <div>
        <label style={labelStyle}>Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)} style={inputStyle}>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="in_review">In Review</option>
            <option value="done">Done</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} style={inputStyle}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Due Date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Team</label>
          <select value={teamId} onChange={(e) => handleTeamChange(e.target.value)} style={inputStyle}>
            <option value="">No team</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>
      {availableMembers.length > 0 && (
        <div>
          <label style={labelStyle}>Assignees</label>
          <AssigneePicker members={availableMembers} selected={assigneeIds} onChange={setAssigneeIds} />
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleSubmit}
          style={{ flex: 1, background: accent, color: "#fff", border: "none", borderRadius: 8, padding: "10px 0", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
        >
          {submitLabel}
        </button>
        <button
          onClick={onCancel}
          style={{ background: "#f1f1f1", border: "none", borderRadius: 8, padding: "10px 14px", cursor: "pointer", fontSize: 13 }}
        >
          Cancel
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            style={{ background: "#faece7", color: "#993c1d", border: "none", borderRadius: 8, padding: "10px 14px", cursor: "pointer", fontSize: 13 }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Add task inline button + form ───────────────────────────────────────────
interface AddTaskInlineProps {
  status:  Status;
  accent:  string;
  teams:   Team[];
  members: TeamMember[];
  onAdd:   (fields: NewTaskFields, status: Status) => void;
}

function AddTaskInline({ status, accent, teams, members, onAdd }: AddTaskInlineProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "none", border: `1px dashed ${accent}55`,
          borderRadius: 8, padding: "8px 12px", cursor: "pointer",
          color: accent, fontSize: 13, width: "100%", marginTop: 4,
        }}
      >
        + Add task
      </button>
    );
  }

  return (
    <div style={{ marginTop: 8, background: "#fff", borderRadius: 10, padding: 14, border: "0.5px solid rgba(0,0,0,0.08)" }}>
      <TaskForm
        status={status}
        accent={accent}
        teams={teams}
        members={members}
        onSubmit={(fields, s) => { onAdd(fields, s); setOpen(false); }}
        onCancel={() => setOpen(false)}
        submitLabel="Add task"
      />
    </div>
  );
}

// ─── Edit task modal ──────────────────────────────────────────────────────────
interface EditModalProps {
  task:        Task;
  assigneeIds: string[];
  teams:       Team[];
  members:     TeamMember[];
  onClose:     () => void;
  onSave:      (id: string, updates: Partial<Task>, assigneeIds: string[]) => void;
  onDelete:    (id: string) => void;
}

function EditModal({ task, assigneeIds, teams, members, onClose, onSave, onDelete }: EditModalProps) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 100, padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 14, padding: 24,
          width: "100%", maxWidth: 480,
          boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#1a1a1a" }}>Edit Task</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#aaa" }}>×</button>
        </div>
        <TaskForm
          initial={{ ...task, assignee_ids: assigneeIds }}
          teams={teams}
          members={members}
          onSubmit={(fields, status) => {
            const { assignee_ids, ...taskFields } = fields;
            onSave(task.id, { ...taskFields, status }, assignee_ids);
            onClose();
          }}
          onCancel={onClose}
          onDelete={() => { onDelete(task.id); onClose(); }}
          submitLabel="Save changes"
        />
        <p style={{ margin: "16px 0 0", fontSize: 11, color: "#ccc" }}>
          Created {new Date(task.created_at).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

// ─── KanbanBoard (main) ───────────────────────────────────────────────────────
export default function KanbanBoard() {
  const [session,     setSession]     = useState<Session | null>(null);
  const [profile,     setProfile]     = useState<Profile | null>(null);
  const [tasks,       setTasks]       = useState<Task[]>([]);
  const [assignees,   setAssignees]   = useState<TaskAssignee[]>([]);
  const [teams,       setTeams]       = useState<Team[]>([]);
  const [members,     setMembers]     = useState<TeamMember[]>([]);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const dragTask = useRef<Task | null>(null);

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function initAuth() {
      const { data: { session: existing } } = await supabase.auth.getSession();
      if (existing) {
        setSession(existing);
      } else {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) { setError("Auth failed: " + error.message); setLoading(false); return; }
        setSession(data.session);
      }
    }
    initAuth();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // ── Load everything once we have a session ────────────────────────────────
  const loadData = useCallback(async (userId: string) => {
    // 1. Profile
    const { data: profileData } = await supabase
      .from("profiles").select("*").eq("user_id", userId).single();
    if (profileData) setProfile(profileData as Profile);

    // 2. Tasks
    const { data: tasksData, error: tasksError } = await supabase
      .from("tasks").select("*").order("created_at", { ascending: true });
    if (tasksError) { setError("Could not load tasks."); }
    else setTasks((tasksData ?? []) as Task[]);

    // 3. Task assignees
    const { data: assigneesData } = await supabase.from("task_assignees").select("*");
    setAssignees((assigneesData ?? []) as TaskAssignee[]);

    // 4. Teams the user belongs to (as creator or member)
    const { data: memberRows } = await supabase
      .from("team_members").select("team_id").eq("user_id", userId);
    const memberTeamIds = (memberRows ?? []).map((r: any) => r.team_id);

    const { data: createdTeams } = await supabase
      .from("teams").select("*").eq("created_by", userId);
    const createdIds = (createdTeams ?? []).map((t: any) => t.id);
    // Deduplicate team IDs without relying on Set iteration (tsconfig ES5 safe)
    const allTeamIds = memberTeamIds
      .concat(createdIds)
      .filter((id: string, idx: number, arr: string[]) => arr.indexOf(id) === idx);

    let teamsData: Team[] = (createdTeams as Team[]) ?? [];
    if (memberTeamIds.length > 0) {
      const { data: joinedTeams } = await supabase
        .from("teams").select("*").in("id", memberTeamIds);
      // Merge and deduplicate by id without new Map(...).values()
      const merged = [...teamsData, ...((joinedTeams ?? []) as Team[])];
      const seen: Record<string, boolean> = {};
      teamsData = merged.filter((t) => { if (seen[t.id]) return false; seen[t.id] = true; return true; });
    }
    setTeams(teamsData);

    // 5. All team members + their profiles
    if (allTeamIds.length > 0) {
      const { data: tmRows } = await supabase
        .from("team_members").select("team_id, user_id").in("team_id", allTeamIds);

      // Deduplicate user IDs without Set iteration
      const memberUserIds = (tmRows ?? [])
        .map((r: any) => r.user_id as string)
        .filter((id: string, idx: number, arr: string[]) => arr.indexOf(id) === idx);
      const { data: profilesData } = await supabase
        .from("profiles").select("*").in("user_id", memberUserIds);

      // Build a lookup object instead of Map (ES5 safe)
      const profileMap: Record<string, Profile> = {};
      (profilesData ?? []).forEach((p: any) => { profileMap[p.user_id] = p as Profile; });
      setAllProfiles((profilesData as Profile[]) ?? []);
      setMembers(
        (tmRows ?? [])
          .filter((r: any) => !!profileMap[r.user_id])
          .map((r: any) => ({ team_id: r.team_id, user_id: r.user_id, profile: profileMap[r.user_id] }))
      );
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    if (!session) return;
    loadData(session.user.id);
  }, [session, loadData]);

  // ── Realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    const channel = supabase.channel("board-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (p) => {
        if (p.eventType === "INSERT") setTasks((prev) => [...prev, p.new as Task]);
        if (p.eventType === "DELETE") setTasks((prev) => prev.filter((t) => t.id !== p.old.id));
        if (p.eventType === "UPDATE") setTasks((prev) => prev.map((t) => t.id === p.new.id ? p.new as Task : t));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "task_assignees" }, (p) => {
        if (p.eventType === "INSERT") setAssignees((prev) => [...prev, p.new as TaskAssignee]);
        if (p.eventType === "DELETE") setAssignees((prev) => prev.filter((a) => !(a.task_id === p.old.task_id && a.user_id === p.old.user_id)));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, (p) => {
        if (p.eventType === "INSERT" || p.eventType === "UPDATE") {
          const prof = p.new as Profile;
          setAllProfiles((prev) => {
            const exists = prev.find((pr) => pr.user_id === prof.user_id);
            return exists ? prev.map((pr) => pr.user_id === prof.user_id ? prof : pr) : [...prev, prof];
          });
          setMembers((prev) => prev.map((m) => m.user_id === prof.user_id ? { ...m, profile: prof } : m));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session]);

  // ── Team actions ──────────────────────────────────────────────────────────
  async function handleCreateTeam(name: string) {
    if (!session) return;
    const { data, error } = await supabase
      .from("teams")
      .insert({ name, created_by: session.user.id })
      .select()
      .single();
    if (error) { console.error(error); return; }
    const team = data as Team;
    setTeams((prev) => [...prev, team]);
    // Auto-add creator as a member
    await supabase.from("team_members").insert({ team_id: team.id, user_id: session.user.id });
    if (profile) {
      setMembers((prev) => [...prev, { team_id: team.id, user_id: session.user.id, profile }]);
    }
  }

  async function handleAddMember(teamId: string, displayName: string) {
    // Look up user by display name
    const { data: found, error } = await supabase
      .from("profiles")
      .select("*")
      .ilike("display_name", displayName.trim())
      .single();

    if (error || !found) {
      console.error("User not found:", displayName);
      return;
    }

    const { error: insertError } = await supabase
      .from("team_members")
      .insert({ team_id: teamId, user_id: found.user_id });

    if (insertError) { console.error(insertError); return; }

    setMembers((prev) => [...prev, { team_id: teamId, user_id: found.user_id, profile: found as Profile }]);
    setAllProfiles((prev) => {
      if (prev.find((p) => p.user_id === found.user_id)) return prev;
      return [...prev, found as Profile];
    });
  }

  async function handleLeaveTeam(teamId: string) {
    if (!session) return;
    const team = teams.find((t) => t.id === teamId);
    if (!team) return;

    if (team.created_by === session.user.id) {
      // Creator deletes the team (cascades to team_members and nullifies task team_id)
      await supabase.from("teams").delete().eq("id", teamId);
      setTeams((prev) => prev.filter((t) => t.id !== teamId));
    } else {
      await supabase.from("team_members").delete().eq("team_id", teamId).eq("user_id", session.user.id);
      setTeams((prev) => prev.filter((t) => t.id !== teamId));
    }
    setMembers((prev) => prev.filter((m) => m.team_id !== teamId));
  }

  // ── Task CRUD ─────────────────────────────────────────────────────────────
  async function handleAddTask(fields: NewTaskFields, status: Status) {
    if (!session) return;
    const { assignee_ids, ...taskFields } = fields;

    // No manual setTasks() here — the realtime INSERT handler is the single
    // place tasks are added to state, preventing the card appearing twice.
    const { data, error } = await supabase
      .from("tasks")
      .insert({ ...taskFields, status, user_id: session.user.id })
      .select()
      .single();
    if (error) { console.error(error); return; }

    // Assignees have no realtime handler, so we manage them manually here.
    // We need the task id from the DB response, hence the .select().single() above.
    if (assignee_ids.length > 0) {
      const rows = assignee_ids.map((uid) => ({ task_id: (data as Task).id, user_id: uid }));
      await supabase.from("task_assignees").insert(rows);
      setAssignees((prev) => [...prev, ...rows]);
    }
  }

  async function handleSaveTask(id: string, updates: Partial<Task>, newAssigneeIds: string[]) {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, ...updates } : t));
    await supabase.from("tasks").update(updates).eq("id", id);

    // Diff assignees: remove old ones, insert new ones
    const current = assignees.filter((a) => a.task_id === id).map((a) => a.user_id);
    const toRemove = current.filter((uid) => !newAssigneeIds.includes(uid));
    const toAdd    = newAssigneeIds.filter((uid) => !current.includes(uid));

    if (toRemove.length > 0) {
      await supabase.from("task_assignees").delete().eq("task_id", id).in("user_id", toRemove);
      setAssignees((prev) => prev.filter((a) => !(a.task_id === id && toRemove.includes(a.user_id))));
    }
    if (toAdd.length > 0) {
      const rows = toAdd.map((uid) => ({ task_id: id, user_id: uid }));
      await supabase.from("task_assignees").insert(rows);
      setAssignees((prev) => [...prev, ...rows]);
    }
  }

  async function handleDeleteTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setAssignees((prev) => prev.filter((a) => a.task_id !== id));
    await supabase.from("tasks").delete().eq("id", id);
  }

  // ── Drag and drop ─────────────────────────────────────────────────────────
  function handleDragStart(e: React.DragEvent, task: Task) {
    dragTask.current = task;
    e.dataTransfer.effectAllowed = "move";
  }

  async function handleDrop(e: React.DragEvent, targetStatus: Status) {
    e.preventDefault();
    const task = dragTask.current;
    if (!task || task.status === targetStatus) return;
    dragTask.current = null;
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: targetStatus } : t));
    await supabase.from("tasks").update({ status: targetStatus }).eq("id", task.id);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <p style={{ color: "#aaa", fontSize: 14 }}>Loading…</p>
      </div>
    );
  }

  // Show onboarding if no profile yet
  if (session && !profile) {
    return <Onboarding userId={session.user.id} onComplete={setProfile} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f7f6f2", fontFamily: "''Helvetica Neue', Helvetica, Arial, sans-serif" }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 28px", borderBottom: "0.5px solid #e8e8e8", background: "#fff",
      }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a1a1a" }}>Project Board</h1>
        {profile && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar profile={profile} size={32} />
            <span style={{ fontSize: 13, color: "#555", fontWeight: 500 }}>{profile.display_name}</span>
          </div>
        )}
      </div>

      {error && (
        <div style={{ margin: "16px 28px 0", padding: "12px 16px", background: "#fcebeb", border: "1px solid #f09595", borderRadius: 8, color: "#791f1f", fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Main layout: sidebar + board */}
      <div style={{ display: "flex", gap: 24, padding: "24px 28px", alignItems: "flex-start" }}>

        {/* Team sidebar */}
        {session && (
          <TeamSidebar
            currentUserId={session.user.id}
            teams={teams}
            members={members}
            onCreateTeam={handleCreateTeam}
            onAddMember={handleAddMember}
            onLeaveTeam={handleLeaveTeam}
          />
        )}

        {/* Board columns */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, alignItems: "start", minWidth: 0 }}>
          {COLUMNS.map((col) => {
            const columnTasks = tasks.filter((t) => t.status === col.id);
            return (
              <div
                key={col.id}
                onDrop={(e) => handleDrop(e, col.id)}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                style={{
                  background: col.color, borderRadius: 14,
                  padding: "14px 14px 16px", minHeight: 320,
                  border: `1px solid ${col.accent}22`,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <h2 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: col.accent, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {col.label}
                  </h2>
                  <span style={{ fontSize: 11, background: `${col.accent}22`, color: col.accent, borderRadius: 99, padding: "2px 8px", fontWeight: 700 }}>
                    {columnTasks.length}
                  </span>
                </div>

                {columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    assigneeIds={assignees.filter((a) => a.task_id === task.id).map((a) => a.user_id)}
                    profiles={allProfiles}
                    onDelete={handleDeleteTask}
                    onDragStart={handleDragStart}
                    onClick={setEditingTask}
                  />
                ))}

                <AddTaskInline
                  status={col.id}
                  accent={col.accent}
                  teams={teams}
                  members={members}
                  onAdd={handleAddTask}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit modal */}
      {editingTask && (
        <EditModal
          task={editingTask}
          assigneeIds={assignees.filter((a) => a.task_id === editingTask.id).map((a) => a.user_id)}
          teams={teams}
          members={members}
          onClose={() => setEditingTask(null)}
          onSave={handleSaveTask}
          onDelete={handleDeleteTask}
        />
      )}
    </div>
  );
}
