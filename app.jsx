import { useState, useEffect, useRef, useCallback } from “react”;

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Replace with your Twitch App Client ID from https://dev.twitch.tv/console
const CLIENT_ID = “YOUR_CLIENT_ID_HERE”;
const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = [
“user:read:email”,
“moderation:read”,
“moderator:manage:banned_users”,
“moderator:manage:chat_messages”,
“moderator:manage:chat_settings”,
“moderator:read:chatters”,
“channel:manage:polls”,
“channel:manage:predictions”,
“channel:read:polls”,
“channel:read:predictions”,
“channel:manage:broadcast”,
“channel:manage:raids”,
“channel:manage:ads”,
“chat:read”,
“chat:edit”,
“channel:moderate”,
“whispers:read”,
“whispers:edit”,
].join(” “);

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getTokenFromHash() {
const hash = window.location.hash.substring(1);
const params = new URLSearchParams(hash);
return params.get(“access_token”);
}

async function twitchAPI(endpoint, token, options = {}) {
const res = await fetch(`https://api.twitch.tv/helix${endpoint}`, {
headers: {
Authorization: `Bearer ${token}`,
“Client-Id”: CLIENT_ID,
“Content-Type”: “application/json”,
},
…options,
});
if (!res.ok) {
const err = await res.json().catch(() => ({}));
throw new Error(err.message || `API error ${res.status}`);
}
return res.json().catch(() => ({}));
}

// IRC-over-WebSocket for chat
function createChatConnection(token, username, channel, onMessage) {
const ws = new WebSocket(“wss://irc-ws.chat.twitch.tv:443”);
ws.onopen = () => {
ws.send(`PASS oauth:${token}`);
ws.send(`NICK ${username}`);
ws.send(`CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership`);
ws.send(`JOIN #${channel}`);
};
ws.onmessage = (e) => {
const lines = e.data.split(”\r\n”).filter(Boolean);
lines.forEach((line) => {
if (line.startsWith(“PING”)) { ws.send(“PONG :tmi.twitch.tv”); return; }
const tagMatch = line.match(/^@([^ ]+) :([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.+)$/);
if (tagMatch) {
const tags = Object.fromEntries(tagMatch[1].split(”;”).map(t => t.split(”=”)));
onMessage({
id: tags.id || Math.random().toString(36),
user: tagMatch[2],
displayName: tags[“display-name”] || tagMatch[2],
color: tags.color || “#9147ff”,
text: tagMatch[3],
badges: tags.badges || “”,
ts: Date.now(),
mod: tags.mod === “1”,
subscriber: tags.subscriber === “1”,
});
}
});
};
return ws;
}

// ─── BADGE ICONS ─────────────────────────────────────────────────────────────
function Badge({ badges }) {
const list = badges.split(”,”).map(b => b.split(”/”)[0]).filter(Boolean);
return (
<span className="badges">
{list.map(b => (
<span key={b} className={`badge badge-${b}`} title={b}>
{b === “broadcaster” ? “🎙” : b === “moderator” ? “⚔️” : b === “subscriber” ? “⭐” : b === “vip” ? “💎” : “”}
</span>
))}
</span>
);
}

// ─── MODAL ───────────────────────────────────────────────────────────────────
function Modal({ title, children, onClose }) {
return (
<div className="modal-overlay" onClick={onClose}>
<div className=“modal” onClick={e => e.stopPropagation()}>
<div className="modal-header">
<h3>{title}</h3>
<button className="modal-close" onClick={onClose}>✕</button>
</div>
<div className="modal-body">{children}</div>
</div>
</div>
);
}

// ─── TOAST ───────────────────────────────────────────────────────────────────
function Toast({ toasts }) {
return (
<div className="toast-container">
{toasts.map(t => (
<div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
))}
</div>
);
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
const [token, setToken] = useState(() => {
const fromHash = getTokenFromHash();
if (fromHash) {
sessionStorage.setItem(“twitch_token”, fromHash);
window.history.replaceState({}, document.title, window.location.pathname);
return fromHash;
}
return sessionStorage.getItem(“twitch_token”);
});

const [me, setMe] = useState(null);
const [modChannels, setModChannels] = useState([]);
const [selectedChannel, setSelectedChannel] = useState(null);
const [channelInfo, setChannelInfo] = useState(null);
const [streamInfo, setStreamInfo] = useState(null);
const [chat, setChat] = useState([]);
const [chatInput, setChatInput] = useState(””);
const [modal, setModal] = useState(null); // { type, data }
const [toasts, setToasts] = useState([]);
const [activeTab, setActiveTab] = useState(“chat”);
const [searchUser, setSearchUser] = useState(””);
const [polls, setPolls] = useState([]);
const [predictions, setPredictions] = useState([]);
const [slowMode, setSlowMode] = useState(false);
const [subOnly, setSubOnly] = useState(false);
const [emotesOnly, setEmotesOnly] = useState(false);
const [followerOnly, setFollowerOnly] = useState(false);
const [loading, setLoading] = useState(false);

const chatRef = useRef(null);
const wsRef = useRef(null);
const toastIdRef = useRef(0);

const toast = useCallback((msg, type = “success”) => {
const id = ++toastIdRef.current;
setToasts(p => […p, { id, msg, type }]);
setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3000);
}, []);

// Load user info
useEffect(() => {
if (!token) return;
twitchAPI(”/users”, token)
.then(d => setMe(d.data?.[0]))
.catch(() => { setToken(null); sessionStorage.removeItem(“twitch_token”); });
}, [token]);

// Load mod channels
useEffect(() => {
if (!token || !me) return;
twitchAPI(`/moderation/channels?user_id=${me.id}&first=100`, token)
.then(d => setModChannels(d.data || []))
.catch(() => {});
}, [token, me]);

// Load channel info + stream + chat settings when channel selected
useEffect(() => {
if (!token || !selectedChannel) return;
const cid = selectedChannel.broadcaster_id;

```
twitchAPI(`/channels?broadcaster_id=${cid}`, token).then(d => setChannelInfo(d.data?.[0]));
twitchAPI(`/streams?user_id=${cid}`, token).then(d => setStreamInfo(d.data?.[0] || null));
twitchAPI(`/chat/settings?broadcaster_id=${cid}&moderator_id=${me.id}`, token).then(d => {
  const s = d.data?.[0] || {};
  setSlowMode(s.slow_mode || false);
  setSubOnly(s.subscriber_mode || false);
  setEmotesOnly(s.emote_mode || false);
  setFollowerOnly(s.follower_mode || false);
});

// Connect chat WebSocket
if (wsRef.current) wsRef.current.close();
const ws = createChatConnection(token, me.login, selectedChannel.broadcaster_login, (msg) => {
  setChat(prev => [...prev.slice(-199), msg]);
});
wsRef.current = ws;

return () => ws.close();
```

}, [token, selectedChannel, me]);

// Auto-scroll chat
useEffect(() => {
if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
}, [chat]);

function login() {
const url = `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=token&scope=${encodeURIComponent(SCOPES)}`;
window.location.href = url;
}

function logout() {
setToken(null); setMe(null); setSelectedChannel(null); setChat([]);
sessionStorage.removeItem(“twitch_token”);
}

async function sendChat() {
if (!chatInput.trim() || !wsRef.current) return;
wsRef.current.send(`PRIVMSG #${selectedChannel.broadcaster_login} :${chatInput}`);
setChatInput(””);
}

async function apiAction(fn, successMsg) {
setLoading(true);
try {
await fn();
toast(successMsg);
} catch (e) {
toast(e.message, “error”);
} finally {
setLoading(false);
setModal(null);
}
}

// ── CHAT SETTINGS ──
async function toggleChatSetting(key, value) {
const cid = selectedChannel.broadcaster_id;
const body = {};
if (key === “slow_mode”) { body.slow_mode = value; if (value) body.slow_mode_wait_time = 30; }
if (key === “subscriber_mode”) body.subscriber_mode = value;
if (key === “emote_mode”) body.emote_mode = value;
if (key === “follower_mode”) { body.follower_mode = value; if (value) body.follower_mode_duration = 0; }
await apiAction(
() => twitchAPI(`/chat/settings?broadcaster_id=${cid}&moderator_id=${me.id}`, token, {
method: “PATCH”, body: JSON.stringify(body),
}),
`Chat setting updated`
);
}

// ── BAN / TIMEOUT ──
async function banUser(userId, duration, reason) {
const body = duration
? { data: { user_id: userId, duration: parseInt(duration), reason } }
: { data: { user_id: userId, reason } };
await apiAction(
() => twitchAPI(`/moderation/bans?broadcaster_id=${selectedChannel.broadcaster_id}&moderator_id=${me.id}`, token, {
method: “POST”, body: JSON.stringify(body),
}),
duration ? `User timed out for ${duration}s` : “User banned”
);
}

async function unbanUser(userId) {
await apiAction(
() => twitchAPI(`/moderation/bans?broadcaster_id=${selectedChannel.broadcaster_id}&moderator_id=${me.id}&user_id=${userId}`, token, {
method: “DELETE”,
}),
“User unbanned / untimeout”
);
}

async function deleteMessage(msgId) {
await apiAction(
() => twitchAPI(`/moderation/chat?broadcaster_id=${selectedChannel.broadcaster_id}&moderator_id=${me.id}&message_id=${msgId}`, token, {
method: “DELETE”,
}),
“Message deleted”
);
}

async function clearChat() {
await apiAction(
() => twitchAPI(`/moderation/chat?broadcaster_id=${selectedChannel.broadcaster_id}&moderator_id=${me.id}`, token, {
method: “DELETE”,
}),
“Chat cleared”
);
}

// ── TITLE / CATEGORY ──
async function updateChannelInfo(title, gameId) {
const body = {};
if (title !== undefined) body.title = title;
if (gameId !== undefined) body.game_id = gameId;
await apiAction(
() => twitchAPI(`/channels?broadcaster_id=${selectedChannel.broadcaster_id}`, token, {
method: “PATCH”, body: JSON.stringify(body),
}),
“Channel info updated”
);
twitchAPI(`/channels?broadcaster_id=${selectedChannel.broadcaster_id}`, token).then(d => setChannelInfo(d.data?.[0]));
}

// ── POLLS ──
async function createPoll(title, choices, duration) {
await apiAction(
() => twitchAPI(”/polls”, token, {
method: “POST”,
body: JSON.stringify({
broadcaster_id: selectedChannel.broadcaster_id,
title, duration: parseInt(duration),
choices: choices.filter(Boolean).map(c => ({ title: c })),
}),
}),
“Poll created!”
);
}

async function endPoll(pollId, status) {
await apiAction(
() => twitchAPI(”/polls”, token, {
method: “PATCH”,
body: JSON.stringify({ broadcaster_id: selectedChannel.broadcaster_id, id: pollId, status }),
}),
`Poll ${status.toLowerCase()}`
);
}

async function loadPolls() {
const d = await twitchAPI(`/polls?broadcaster_id=${selectedChannel.broadcaster_id}`, token);
setPolls(d.data || []);
}

// ── PREDICTIONS ──
async function createPrediction(title, outcomes, duration) {
await apiAction(
() => twitchAPI(”/predictions”, token, {
method: “POST”,
body: JSON.stringify({
broadcaster_id: selectedChannel.broadcaster_id,
title, prediction_window: parseInt(duration),
outcomes: outcomes.filter(Boolean).map(o => ({ title: o })),
}),
}),
“Prediction created!”
);
}

// ── RAID ──
async function startRaid(targetLogin) {
const userData = await twitchAPI(`/users?login=${targetLogin}`, token);
const targetId = userData.data?.[0]?.id;
if (!targetId) throw new Error(“User not found”);
await apiAction(
() => twitchAPI(`/raids?from_broadcaster_id=${selectedChannel.broadcaster_id}&to_broadcaster_id=${targetId}`, token, {
method: “POST”,
}),
`Raiding ${targetLogin}!`
);
}

async function cancelRaid() {
await apiAction(
() => twitchAPI(`/raids?broadcaster_id=${selectedChannel.broadcaster_id}`, token, { method: “DELETE” }),
“Raid cancelled”
);
}

// ── LOOKUP USER ──
async function lookupUser(login) {
const d = await twitchAPI(`/users?login=${login}`, token);
return d.data?.[0];
}

// ─── SETUP SCREEN ─────────────────────────────────────────────────────────
if (!token) {
return (
<>
<style>{CSS}</style>
<div className="setup-screen">
<div className="setup-card">
<div className="setup-logo">
<svg width="48" height="48" viewBox="0 0 24 24" fill="#9147ff"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>
</div>
<h1>TwitchMod Pro</h1>
<p className="setup-sub">Full moderator dashboard for your channels</p>
{CLIENT_ID === “YOUR_CLIENT_ID_HERE” ? (
<div className="setup-warning">
<h3>⚙️ Setup Required</h3>
<p>To use this app, you need a Twitch Developer Client ID:</p>
<ol>
<li>Go to <a href="https://dev.twitch.tv/console" target="_blank" rel="noreferrer">dev.twitch.tv/console</a></li>
<li>Click <strong>Register Your Application</strong></li>
<li>Name: anything (e.g. “My Mod Dashboard”)</li>
<li>OAuth Redirect URL: <code>{REDIRECT_URI}</code></li>
<li>Category: <strong>Other</strong></li>
<li>Copy the <strong>Client ID</strong></li>
<li>Replace <code>YOUR_CLIENT_ID_HERE</code> in this file’s source code with your Client ID</li>
</ol>
</div>
) : (
<button className="btn-twitch" onClick={login}>
<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>
Connect with Twitch
</button>
)}
</div>
</div>
</>
);
}

// ─── CHANNEL SELECT ───────────────────────────────────────────────────────
if (!selectedChannel) {
return (
<>
<style>{CSS}</style>
<div className="channel-select-screen">
<div className="channel-select-card">
<div className="channel-select-header">
<img src={me?.profile_image_url} alt="" className="avatar" />
<div>
<h2>Welcome, {me?.display_name}</h2>
<p>Select a channel you moderate</p>
</div>
<button className="btn-ghost" onClick={logout}>Logout</button>
</div>
{modChannels.length === 0 ? (
<div className="empty-state">You don’t moderate any channels, or permissions weren’t granted.</div>
) : (
<div className="channel-list">
{modChannels.map(ch => (
<button key={ch.broadcaster_id} className=“channel-item” onClick={() => setSelectedChannel(ch)}>
<div className="channel-avatar-wrap">
<span className="channel-initial">{ch.broadcaster_name[0]}</span>
</div>
<div className="channel-item-info">
<strong>{ch.broadcaster_name}</strong>
<span>@{ch.broadcaster_login}</span>
</div>
<span className="channel-arrow">→</span>
</button>
))}
</div>
)}
</div>
</div>
</>
);
}

// ─── MODALS ───────────────────────────────────────────────────────────────
function renderModal() {
if (!modal) return null;
const { type, data } = modal;

```
if (type === "edit-title") {
  let newTitle = channelInfo?.title || "";
  return (
    <Modal title="Edit Stream Title" onClose={() => setModal(null)}>
      <input className="input" defaultValue={newTitle} onChange={e => newTitle = e.target.value} placeholder="Stream title" />
      <button className="btn-primary" onClick={() => updateChannelInfo(newTitle, undefined)}>Save Title</button>
    </Modal>
  );
}

if (type === "ban-user") {
  let reason = "";
  return (
    <Modal title={`Ban ${data.displayName}`} onClose={() => setModal(null)}>
      <p className="modal-note">This will permanently ban the user from chat.</p>
      <input className="input" placeholder="Reason (optional)" onChange={e => reason = e.target.value} />
      <button className="btn-danger" onClick={() => banUser(data.userId, null, reason)}>Confirm Ban</button>
    </Modal>
  );
}

if (type === "timeout") {
  let duration = "600"; let reason = "";
  return (
    <Modal title={`Timeout ${data.displayName}`} onClose={() => setModal(null)}>
      <select className="input" onChange={e => duration = e.target.value} defaultValue="600">
        <option value="60">1 minute</option>
        <option value="300">5 minutes</option>
        <option value="600">10 minutes</option>
        <option value="1800">30 minutes</option>
        <option value="3600">1 hour</option>
        <option value="86400">1 day</option>
        <option value="604800">1 week</option>
      </select>
      <input className="input" placeholder="Reason (optional)" onChange={e => reason = e.target.value} />
      <button className="btn-warning" onClick={() => banUser(data.userId, duration, reason)}>Timeout</button>
    </Modal>
  );
}

if (type === "poll") {
  let title = ""; let choices = ["", ""]; let duration = "60";
  return (
    <Modal title="Create Poll" onClose={() => setModal(null)}>
      <input className="input" placeholder="Poll question" onChange={e => title = e.target.value} />
      {[0, 1, 2, 3, 4].map(i => (
        <input key={i} className="input" placeholder={`Choice ${i + 1}${i < 2 ? " (required)" : " (optional)"}`}
          onChange={e => { choices[i] = e.target.value; }} />
      ))}
      <select className="input" onChange={e => duration = e.target.value} defaultValue="60">
        <option value="30">30 seconds</option>
        <option value="60">1 minute</option>
        <option value="120">2 minutes</option>
        <option value="300">5 minutes</option>
      </select>
      <button className="btn-primary" onClick={() => createPoll(title, choices, duration)}>Create Poll</button>
    </Modal>
  );
}

if (type === "prediction") {
  let title = ""; let outcomes = ["", ""]; let duration = "120";
  return (
    <Modal title="Create Prediction" onClose={() => setModal(null)}>
      <input className="input" placeholder="Prediction title" onChange={e => title = e.target.value} />
      <input className="input" placeholder="Outcome 1 (e.g. Yes)" onChange={e => { outcomes[0] = e.target.value; }} />
      <input className="input" placeholder="Outcome 2 (e.g. No)" onChange={e => { outcomes[1] = e.target.value; }} />
      <select className="input" onChange={e => duration = e.target.value} defaultValue="120">
        <option value="30">30 seconds</option>
        <option value="60">1 minute</option>
        <option value="120">2 minutes</option>
        <option value="300">5 minutes</option>
      </select>
      <button className="btn-primary" onClick={() => createPrediction(title, outcomes, duration)}>Start Prediction</button>
    </Modal>
  );
}

if (type === "raid") {
  let target = "";
  return (
    <Modal title="Start a Raid" onClose={() => setModal(null)}>
      <input className="input" placeholder="Channel to raid (username)" onChange={e => target = e.target.value} />
      <div className="btn-row">
        <button className="btn-primary" onClick={() => startRaid(target)}>Start Raid</button>
        <button className="btn-ghost" onClick={() => cancelRaid()}>Cancel Raid</button>
      </div>
    </Modal>
  );
}

if (type === "user-lookup") {
  return (
    <UserLookupModal token={token} me={me} channel={selectedChannel} onBan={(u) => { setModal({ type: "ban-user", data: u }); }}
      onTimeout={(u) => { setModal({ type: "timeout", data: u }); }}
      onUnban={async (id) => { await unbanUser(id); setModal(null); }}
      onClose={() => setModal(null)} toast={toast} />
  );
}

return null;
```

}

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────
return (
<>
<style>{CSS}</style>
<div className="dashboard">
{/* Sidebar */}
<aside className="sidebar">
<div className="sidebar-brand">
<svg width="24" height="24" viewBox="0 0 24 24" fill="#9147ff"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>
<span>ModPro</span>
</div>

```
      <div className="sidebar-channel">
        <div className="sidebar-channel-name">{selectedChannel.broadcaster_name}</div>
        {streamInfo ? <span className="live-badge">● LIVE</span> : <span className="offline-badge">OFFLINE</span>}
      </div>

      <nav className="sidebar-nav">
        {[
          { id: "chat", icon: "💬", label: "Chat" },
          { id: "stream", icon: "📺", label: "Stream" },
          { id: "modtools", icon: "⚔️", label: "Mod Tools" },
          { id: "polls", icon: "📊", label: "Polls" },
        ].map(tab => (
          <button key={tab.id} className={`nav-item ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <img src={me?.profile_image_url} alt="" className="avatar-sm" />
        <span>{me?.display_name}</span>
        <button className="btn-ghost-sm" onClick={() => { setSelectedChannel(null); setChat([]); if (wsRef.current) wsRef.current.close(); }}>← Back</button>
      </div>
    </aside>

    {/* Main content */}
    <main className="main-content">
      {activeTab === "chat" && (
        <div className="chat-panel">
          <div className="chat-header">
            <h2>Live Chat <span className="chat-channel">#{selectedChannel.broadcaster_login}</span></h2>
            <button className="btn-danger-sm" onClick={clearChat}>Clear Chat</button>
          </div>
          <div className="chat-messages" ref={chatRef}>
            {chat.length === 0 && <div className="chat-empty">Waiting for messages...</div>}
            {chat.map(msg => (
              <div key={msg.id} className="chat-message">
                <Badge badges={msg.badges} />
                <span className="chat-username" style={{ color: msg.color || "#9147ff" }}>{msg.displayName}</span>
                <span className="chat-text">{msg.text}</span>
                <div className="chat-actions">
                  <button onClick={() => setModal({ type: "timeout", data: { userId: null, displayName: msg.user, userLogin: msg.user } })} title="Timeout">⏱</button>
                  <button onClick={() => setModal({ type: "ban-user", data: { userId: null, displayName: msg.user, userLogin: msg.user } })} title="Ban">🔨</button>
                  <button onClick={() => deleteMessage(msg.id)} title="Delete message">🗑</button>
                </div>
              </div>
            ))}
          </div>
          <div className="chat-input-row">
            <input className="chat-input" value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendChat()} placeholder={`Chat as ${me?.display_name}...`} />
            <button className="btn-send" onClick={sendChat}>Send</button>
          </div>
        </div>
      )}

      {activeTab === "stream" && (
        <div className="stream-panel">
          <div className="stream-embed-wrap">
            {streamInfo ? (
              <iframe
                src={`https://player.twitch.tv/?channel=${selectedChannel.broadcaster_login}&parent=${window.location.hostname}&muted=false`}
                allowFullScreen frameBorder="0" className="stream-embed" title="Twitch Stream"
              />
            ) : (
              <div className="offline-placeholder">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="#9147ff"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>
                <p>Channel is currently offline</p>
              </div>
            )}
          </div>
          <div className="stream-info-card">
            <div className="stream-info-row">
              <span className="info-label">Title</span>
              <span className="info-value">{channelInfo?.title || "—"}</span>
              <button className="btn-edit" onClick={() => setModal({ type: "edit-title" })}>Edit</button>
            </div>
            <div className="stream-info-row">
              <span className="info-label">Category</span>
              <span className="info-value">{channelInfo?.game_name || "—"}</span>
            </div>
            {streamInfo && <>
              <div className="stream-info-row">
                <span className="info-label">Viewers</span>
                <span className="info-value">{streamInfo.viewer_count?.toLocaleString()}</span>
              </div>
              <div className="stream-info-row">
                <span className="info-label">Started</span>
                <span className="info-value">{new Date(streamInfo.started_at).toLocaleTimeString()}</span>
              </div>
            </>}
            <div className="btn-row mt">
              <button className="btn-purple" onClick={() => setModal({ type: "raid" })}>⚡ Start Raid</button>
            </div>
          </div>
        </div>
      )}

      {activeTab === "modtools" && (
        <div className="modtools-panel">
          <h2>Moderator Tools</h2>

          <section className="mod-section">
            <h3>Chat Settings</h3>
            <div className="toggle-grid">
              {[
                { key: "slow_mode", label: "Slow Mode", val: slowMode, set: setSlowMode },
                { key: "subscriber_mode", label: "Subscribers Only", val: subOnly, set: setSubOnly },
                { key: "emote_mode", label: "Emotes Only", val: emotesOnly, set: setEmotesOnly },
                { key: "follower_mode", label: "Followers Only", val: followerOnly, set: setFollowerOnly },
              ].map(({ key, label, val, set }) => (
                <label key={key} className="toggle-item">
                  <span>{label}</span>
                  <div className={`toggle ${val ? "on" : ""}`} onClick={() => {
                    const next = !val; set(next); toggleChatSetting(key, next);
                  }}>
                    <div className="toggle-thumb" />
                  </div>
                </label>
              ))}
            </div>
          </section>

          <section className="mod-section">
            <h3>User Actions</h3>
            <div className="user-search-row">
              <input className="input" placeholder="Search username..." value={searchUser} onChange={e => setSearchUser(e.target.value)} />
              <button className="btn-primary" onClick={() => setModal({ type: "user-lookup", data: { login: searchUser } })}>Lookup</button>
            </div>
          </section>

          <section className="mod-section">
            <h3>Quick Actions</h3>
            <div className="quick-actions">
              <button className="qa-btn" onClick={() => setModal({ type: "poll" })}>📊 Create Poll</button>
              <button className="qa-btn" onClick={() => setModal({ type: "prediction" })}>🔮 Prediction</button>
              <button className="qa-btn" onClick={() => setModal({ type: "raid" })}>⚡ Raid</button>
              <button className="qa-btn" onClick={() => setModal({ type: "edit-title" })}>✏️ Edit Title</button>
              <button className="qa-btn danger" onClick={clearChat}>🗑 Clear Chat</button>
            </div>
          </section>
        </div>
      )}

      {activeTab === "polls" && (
        <div className="polls-panel">
          <div className="polls-header">
            <h2>Polls & Predictions</h2>
            <div className="btn-row">
              <button className="btn-primary" onClick={() => setModal({ type: "poll" })}>+ New Poll</button>
              <button className="btn-purple" onClick={() => setModal({ type: "prediction" })}>+ Prediction</button>
              <button className="btn-ghost" onClick={loadPolls}>Refresh</button>
            </div>
          </div>
          {polls.length === 0 ? (
            <div className="empty-state">No polls found. Click "Refresh" or create one!</div>
          ) : polls.map(poll => (
            <div key={poll.id} className="poll-card">
              <div className="poll-title">{poll.title}</div>
              <div className="poll-status">{poll.status}</div>
              <div className="poll-choices">
                {poll.choices.map(c => (
                  <div key={c.id} className="poll-choice">
                    <span>{c.title}</span>
                    <span className="poll-votes">{c.votes} votes</span>
                  </div>
                ))}
              </div>
              {poll.status === "ACTIVE" && (
                <div className="btn-row">
                  <button className="btn-warning" onClick={() => endPoll(poll.id, "TERMINATED")}>End Poll</button>
                  <button className="btn-danger-sm" onClick={() => endPoll(poll.id, "ARCHIVED")}>Archive</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  </div>

  {renderModal()}
  <Toast toasts={toasts} />
  {loading && <div className="loading-overlay"><div className="spinner" /></div>}
</>
```

);
}

// ─── USER LOOKUP MODAL ────────────────────────────────────────────────────────
function UserLookupModal({ token, me, channel, onBan, onTimeout, onUnban, onClose, toast }) {
const [login, setLogin] = useState(””);
const [user, setUser] = useState(null);
const [loading, setLoading] = useState(false);

async function search() {
if (!login.trim()) return;
setLoading(true);
try {
const d = await twitchAPI(`/users?login=${login.trim()}`, token);
const u = d.data?.[0];
if (!u) { toast(“User not found”, “error”); return; }
setUser(u);
} catch (e) { toast(e.message, “error”); }
finally { setLoading(false); }
}

return (
<Modal title="User Lookup" onClose={onClose}>
<div className="user-lookup">
<div className="search-row">
<input className=“input” placeholder=“Username” value={login} onChange={e => setLogin(e.target.value)}
onKeyDown={e => e.key === “Enter” && search()} />
<button className="btn-primary" onClick={search}>{loading ? “…” : “Search”}</button>
</div>
{user && (
<div className="user-profile">
<img src={user.profile_image_url} alt="" className="avatar-md" />
<div className="user-info">
<strong>{user.display_name}</strong>
<span>@{user.login}</span>
<span className="user-desc">{user.description?.slice(0, 80) || “No description”}</span>
</div>
<div className="user-actions-btns">
<button className=“btn-warning” onClick={() => onTimeout({ userId: user.id, displayName: user.display_name })}>Timeout</button>
<button className=“btn-danger” onClick={() => onBan({ userId: user.id, displayName: user.display_name })}>Ban</button>
<button className=“btn-ghost” onClick={() => onUnban(user.id)}>Unban</button>
</div>
</div>
)}
</div>
</Modal>
);
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url(‘https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap’);

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
–bg: #0e0e10;
–bg2: #18181b;
–bg3: #1f1f23;
–border: #2a2a2e;
–purple: #9147ff;
–purple-light: #a970ff;
–text: #efeff1;
–text-muted: #adadb8;
–red: #eb0400;
–orange: #ff9147;
–green: #00c853;
–radius: 8px;
–font: ‘Space Grotesk’, sans-serif;
}

body { background: var(–bg); color: var(–text); font-family: var(–font); font-size: 14px; }
a { color: var(–purple-light); }

/* SETUP */
.setup-screen {
min-height: 100vh; display: flex; align-items: center; justify-content: center;
background: radial-gradient(ellipse at 50% 0%, #1a0f2e 0%, var(–bg) 70%);
}
.setup-card {
background: var(–bg2); border: 1px solid var(–border); border-radius: 16px;
padding: 48px; max-width: 520px; width: 100%; text-align: center;
}
.setup-logo { margin-bottom: 16px; }
.setup-card h1 { font-size: 32px; font-weight: 700; margin-bottom: 8px; }
.setup-sub { color: var(–text-muted); margin-bottom: 32px; }
.setup-warning {
text-align: left; background: var(–bg3); border: 1px solid var(–border);
border-radius: var(–radius); padding: 20px; margin-bottom: 24px;
}
.setup-warning h3 { margin-bottom: 12px; color: var(–orange); }
.setup-warning p { color: var(–text-muted); margin-bottom: 12px; }
.setup-warning ol { padding-left: 20px; line-height: 1.9; color: var(–text-muted); }
.setup-warning strong { color: var(–text); }
.setup-warning code {
background: var(–bg); padding: 2px 6px; border-radius: 4px;
font-family: monospace; font-size: 12px; word-break: break-all;
}
.btn-twitch {
display: inline-flex; align-items: center; gap: 10px;
background: var(–purple); color: white; border: none; border-radius: var(–radius);
padding: 14px 28px; font-size: 16px; font-weight: 600; cursor: pointer; transition: background .2s;
}
.btn-twitch:hover { background: var(–purple-light); }

/* CHANNEL SELECT */
.channel-select-screen {
min-height: 100vh; display: flex; align-items: center; justify-content: center;
background: radial-gradient(ellipse at 50% 0%, #1a0f2e 0%, var(–bg) 70%);
}
.channel-select-card {
background: var(–bg2); border: 1px solid var(–border); border-radius: 16px;
padding: 32px; max-width: 480px; width: 100%;
}
.channel-select-header {
display: flex; align-items: center; gap: 12px; margin-bottom: 24px;
padding-bottom: 24px; border-bottom: 1px solid var(–border);
}
.channel-select-header h2 { font-size: 18px; margin-bottom: 2px; }
.channel-select-header p { color: var(–text-muted); font-size: 13px; }
.channel-select-header .btn-ghost { margin-left: auto; }
.avatar { width: 44px; height: 44px; border-radius: 50%; }
.channel-list { display: flex; flex-direction: column; gap: 8px; }
.channel-item {
display: flex; align-items: center; gap: 14px;
background: var(–bg3); border: 1px solid var(–border); border-radius: var(–radius);
padding: 14px 16px; cursor: pointer; transition: border-color .2s, background .2s; text-align: left;
color: var(–text); width: 100%;
}
.channel-item:hover { border-color: var(–purple); background: #1a1a24; }
.channel-avatar-wrap {
width: 40px; height: 40px; border-radius: 50%; background: var(–purple);
display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; flex-shrink: 0;
}
.channel-item-info { display: flex; flex-direction: column; }
.channel-item-info strong { font-size: 15px; }
.channel-item-info span { color: var(–text-muted); font-size: 12px; }
.channel-arrow { margin-left: auto; color: var(–text-muted); }
.empty-state { color: var(–text-muted); text-align: center; padding: 32px 0; }

/* DASHBOARD LAYOUT */
.dashboard { display: flex; height: 100vh; overflow: hidden; }

/* SIDEBAR */
.sidebar {
width: 220px; flex-shrink: 0;
background: var(–bg2); border-right: 1px solid var(–border);
display: flex; flex-direction: column;
}
.sidebar-brand {
display: flex; align-items: center; gap: 10px;
padding: 18px 16px; font-size: 18px; font-weight: 700;
border-bottom: 1px solid var(–border);
}
.sidebar-channel {
padding: 14px 16px; border-bottom: 1px solid var(–border);
}
.sidebar-channel-name { font-weight: 600; font-size: 15px; margin-bottom: 4px; }
.live-badge { background: #eb0400; color: white; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 4px; }
.offline-badge { color: var(–text-muted); font-size: 12px; }
.sidebar-nav { flex: 1; padding: 10px 8px; display: flex; flex-direction: column; gap: 2px; }
.nav-item {
display: flex; align-items: center; gap: 10px;
padding: 10px 12px; border-radius: var(–radius); border: none;
background: none; color: var(–text-muted); cursor: pointer; font-family: var(–font); font-size: 14px; font-weight: 500;
transition: background .15s, color .15s; text-align: left; width: 100%;
}
.nav-item:hover { background: var(–bg3); color: var(–text); }
.nav-item.active { background: rgba(145,71,255,0.18); color: var(–purple-light); }
.sidebar-footer {
padding: 14px 16px; border-top: 1px solid var(–border);
display: flex; align-items: center; gap: 8px; font-size: 13px;
}
.avatar-sm { width: 28px; height: 28px; border-radius: 50%; }
.avatar-md { width: 56px; height: 56px; border-radius: 50%; }
.sidebar-footer span { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* MAIN */
.main-content { flex: 1; overflow: auto; background: var(–bg); }

/* CHAT */
.chat-panel { display: flex; flex-direction: column; height: 100vh; }
.chat-header {
display: flex; align-items: center; justify-content: space-between;
padding: 16px 20px; border-bottom: 1px solid var(–border); background: var(–bg2);
}
.chat-header h2 { font-size: 16px; }
.chat-channel { color: var(–purple-light); font-weight: 400; font-size: 14px; }
.chat-messages { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 4px; }
.chat-empty { color: var(–text-muted); text-align: center; padding: 40px 0; }
.chat-message {
display: flex; align-items: flex-start; gap: 6px; padding: 5px 8px; border-radius: 6px;
transition: background .1s; position: relative; flex-wrap: wrap;
}
.chat-message:hover { background: var(–bg2); }
.chat-message:hover .chat-actions { opacity: 1; }
.badges { display: flex; gap: 2px; align-items: center; }
.badge { font-size: 12px; }
.chat-username { font-weight: 600; font-size: 13px; white-space: nowrap; }
.chat-text { color: var(–text); font-size: 13px; flex: 1; word-break: break-word; }
.chat-actions {
display: flex; gap: 4px; opacity: 0; transition: opacity .15s;
margin-left: auto;
}
.chat-actions button {
background: none; border: none; cursor: pointer; font-size: 14px; padding: 2px 4px;
border-radius: 4px; transition: background .1s;
}
.chat-actions button:hover { background: var(–bg3); }
.chat-input-row {
display: flex; gap: 10px; padding: 14px 16px;
background: var(–bg2); border-top: 1px solid var(–border);
}
.chat-input {
flex: 1; background: var(–bg3); border: 1px solid var(–border); border-radius: var(–radius);
color: var(–text); padding: 10px 14px; font-family: var(–font); font-size: 14px; outline: none;
transition: border-color .15s;
}
.chat-input:focus { border-color: var(–purple); }
.btn-send {
background: var(–purple); color: white; border: none; border-radius: var(–radius);
padding: 10px 20px; font-family: var(–font); font-weight: 600; cursor: pointer; transition: background .2s;
}
.btn-send:hover { background: var(–purple-light); }

/* STREAM PANEL */
.stream-panel { padding: 20px; display: flex; flex-direction: column; gap: 20px; }
.stream-embed-wrap {
background: #000; border-radius: 12px; overflow: hidden;
aspect-ratio: 16/9; max-width: 900px;
}
.stream-embed { width: 100%; height: 100%; display: block; }
.offline-placeholder {
display: flex; flex-direction: column; align-items: center; justify-content: center;
height: 100%; gap: 12px; color: var(–text-muted); min-height: 300px;
}
.stream-info-card {
background: var(–bg2); border: 1px solid var(–border); border-radius: 12px;
padding: 20px; max-width: 900px; display: flex; flex-direction: column; gap: 14px;
}
.stream-info-row { display: flex; align-items: center; gap: 12px; }
.info-label { color: var(–text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: .5px; width: 80px; flex-shrink: 0; }
.info-value { flex: 1; font-weight: 500; }
.btn-edit {
background: none; border: 1px solid var(–border); color: var(–text-muted);
border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; transition: all .15s;
}
.btn-edit:hover { border-color: var(–purple); color: var(–text); }

/* MOD TOOLS */
.modtools-panel { padding: 24px; max-width: 700px; }
.modtools-panel h2 { font-size: 22px; margin-bottom: 20px; }
.mod-section { background: var(–bg2); border: 1px solid var(–border); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
.mod-section h3 { font-size: 14px; text-transform: uppercase; letter-spacing: .5px; color: var(–text-muted); margin-bottom: 16px; }
.toggle-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.toggle-item {
display: flex; align-items: center; justify-content: space-between;
background: var(–bg3); border-radius: var(–radius); padding: 12px 14px; cursor: pointer;
}
.toggle {
width: 40px; height: 22px; background: var(–border); border-radius: 11px;
position: relative; transition: background .2s; flex-shrink: 0;
}
.toggle.on { background: var(–purple); }
.toggle-thumb {
position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
background: white; border-radius: 50%; transition: left .2s;
}
.toggle.on .toggle-thumb { left: 21px; }
.user-search-row { display: flex; gap: 10px; }
.quick-actions { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
.qa-btn {
background: var(–bg3); border: 1px solid var(–border); color: var(–text);
border-radius: var(–radius); padding: 12px 16px; cursor: pointer; font-family: var(–font);
font-size: 14px; font-weight: 500; transition: all .15s; text-align: left;
}
.qa-btn:hover { border-color: var(–purple); background: #1e1e2e; }
.qa-btn.danger:hover { border-color: var(–red); }

/* POLLS */
.polls-panel { padding: 24px; }
.polls-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.polls-header h2 { font-size: 22px; }
.poll-card {
background: var(–bg2); border: 1px solid var(–border); border-radius: 12px;
padding: 20px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 12px;
}
.poll-title { font-size: 16px; font-weight: 600; }
.poll-status { font-size: 12px; color: var(–text-muted); text-transform: uppercase; letter-spacing: .5px; }
.poll-choices { display: flex; flex-direction: column; gap: 8px; }
.poll-choice { display: flex; justify-content: space-between; background: var(–bg3); border-radius: 6px; padding: 8px 12px; }
.poll-votes { color: var(–purple-light); font-weight: 600; }

/* MODAL */
.modal-overlay {
position: fixed; inset: 0; background: rgba(0,0,0,.7); display: flex;
align-items: center; justify-content: center; z-index: 100; backdrop-filter: blur(4px);
}
.modal {
background: var(–bg2); border: 1px solid var(–border); border-radius: 14px;
width: 100%; max-width: 440px; max-height: 90vh; overflow-y: auto;
}
.modal-header {
display: flex; align-items: center; justify-content: space-between;
padding: 18px 20px; border-bottom: 1px solid var(–border);
}
.modal-header h3 { font-size: 16px; font-weight: 600; }
.modal-close {
background: none; border: none; color: var(–text-muted); cursor: pointer;
font-size: 18px; padding: 4px; border-radius: 4px; transition: color .15s;
}
.modal-close:hover { color: var(–text); }
.modal-body { padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.modal-note { color: var(–text-muted); font-size: 13px; }

/* FORMS */
.input {
background: var(–bg3); border: 1px solid var(–border); border-radius: var(–radius);
color: var(–text); padding: 10px 14px; font-family: var(–font); font-size: 14px;
outline: none; width: 100%; transition: border-color .15s;
}
.input:focus { border-color: var(–purple); }
select.input { cursor: pointer; }

/* BUTTONS */
.btn-primary, .btn-danger, .btn-warning, .btn-ghost, .btn-purple, .btn-danger-sm, .btn-ghost-sm {
border: none; border-radius: var(–radius); padding: 10px 18px; cursor: pointer;
font-family: var(–font); font-weight: 600; font-size: 14px; transition: all .15s;
}
.btn-primary { background: var(–purple); color: white; }
.btn-primary:hover { background: var(–purple-light); }
.btn-danger { background: var(–red); color: white; }
.btn-danger:hover { filter: brightness(1.1); }
.btn-warning { background: var(–orange); color: #1a1a1a; }
.btn-warning:hover { filter: brightness(1.1); }
.btn-ghost { background: var(–bg3); border: 1px solid var(–border); color: var(–text); }
.btn-ghost:hover { border-color: var(–purple); }
.btn-purple { background: rgba(145,71,255,.2); border: 1px solid var(–purple); color: var(–purple-light); }
.btn-purple:hover { background: rgba(145,71,255,.35); }
.btn-danger-sm { background: none; border: 1px solid var(–red); color: var(–red); padding: 6px 12px; font-size: 12px; border-radius: 6px; cursor: pointer; font-family: var(–font); font-weight: 600; transition: all .15s; }
.btn-danger-sm:hover { background: rgba(235,4,0,.1); }
.btn-ghost-sm { background: none; border: 1px solid var(–border); color: var(–text-muted); padding: 5px 10px; font-size: 12px; border-radius: 6px; cursor: pointer; font-family: var(–font); transition: all .15s; }
.btn-ghost-sm:hover { color: var(–text); border-color: var(–text-muted); }
.btn-row { display: flex; gap: 10px; flex-wrap: wrap; }
.btn-row.mt { margin-top: 4px; }

/* USER LOOKUP */
.user-lookup { display: flex; flex-direction: column; gap: 16px; }
.search-row { display: flex; gap: 10px; }
.user-profile { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
.user-info { display: flex; flex-direction: column; gap: 3px; flex: 1; }
.user-info strong { font-size: 15px; }
.user-info span { color: var(–text-muted); font-size: 12px; }
.user-desc { font-size: 12px; color: var(–text-muted); }
.user-actions-btns { display: flex; flex-direction: column; gap: 6px; }

/* TOAST */
.toast-container { position: fixed; bottom: 24px; right: 24px; display: flex; flex-direction: column; gap: 8px; z-index: 200; }
.toast {
padding: 12px 18px; border-radius: 8px; font-weight: 500; font-size: 14px;
animation: slideIn .2s ease; box-shadow: 0 4px 20px rgba(0,0,0,.4);
}
.toast-success { background: #0d2e1a; border: 1px solid #00c853; color: #00c853; }
.toast-error { background: #2e0d0d; border: 1px solid var(–red); color: #ff6b6b; }
@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

/* LOADING */
.loading-overlay {
position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex;
align-items: center; justify-content: center; z-index: 300;
}
.spinner {
width: 36px; height: 36px; border: 3px solid var(–border);
border-top-color: var(–purple); border-radius: 50%; animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* SCROLLBAR */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: var(–bg); }
::-webkit-scrollbar-thumb { background: var(–border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #555; }
`;
