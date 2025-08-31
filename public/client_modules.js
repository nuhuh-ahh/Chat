export const state = {
  me: null,
  context: { type: null, target_id: null, channel_id: null, title: "Welcome" },
  socket: null,
  stream: null,
};

export const ui = {
  els: {},
  init() {
    this.cacheEls();
    this.bindAuthTabs();
    this.bindAuth();
    this.bindActions();
    this.renderEmojiPicker();
    this.pingSound = this.makePing();
  },
  cacheEls() {
    this.els.authPanel = document.getElementById("authPanel");
    this.els.tabLogin = document.getElementById("tabLogin");
    this.els.tabRegister = document.getElementById("tabRegister");
    this.els.loginForm = document.getElementById("loginForm");
    this.els.registerForm = document.getElementById("registerForm");
    this.els.chatLayout = document.getElementById("chatLayout");
    this.els.meAvatar = document.getElementById("meAvatar");
    this.els.meUsername = document.getElementById("meUsername");
    this.els.openSettings = document.getElementById("openSettings");
    this.els.messages = document.getElementById("messages");
    this.els.messageInput = document.getElementById("messageInput");
    this.els.sendBtn = document.getElementById("sendBtn");
    this.els.fileInput = document.getElementById("fileInput");
    this.els.friendsList = document.getElementById("friendsList");
    this.els.groupsList = document.getElementById("groupsList");
    this.els.addFriendInput = document.getElementById("addFriendInput");
    this.els.addFriendBtn = document.getElementById("addFriendBtn");
    this.els.newGroupName = document.getElementById("newGroupName");
    this.els.createGroup = document.getElementById("createGroup");
    this.els.settingsModal = document.getElementById("settingsModal");
    this.els.saveSettings = document.getElementById("saveSettings");
    this.els.closeSettings = document.getElementById("closeSettings");
    this.els.setUsername = document.getElementById("setUsername");
    this.els.setAvatar = document.getElementById("setAvatar");
    this.els.setBio = document.getElementById("setBio");
    this.els.contextTitle = document.getElementById("contextTitle");
    this.els.groupModal = document.getElementById("groupModal");
    this.els.groupOps = document.getElementById("groupOps");
    this.els.closeGroup = document.getElementById("closeGroup");

    this.els.vcRoom = document.getElementById("vcRoom");
    this.els.vcJoin = document.getElementById("vcJoin");
    this.els.vcLeave = document.getElementById("vcLeave");
    this.els.vcMute = document.getElementById("vcMute");

    this.els.emojiBtn = document.getElementById("emojiBtn");
    this.els.emojiPicker = document.getElementById("emojiPicker");
  },
  bindAuthTabs() {
    this.els.tabLogin.onclick = () => {
      this.els.tabLogin.classList.add("active");
      this.els.tabRegister.classList.remove("active");
      this.els.loginForm.classList.remove("hidden");
      this.els.registerForm.classList.add("hidden");
    };
    this.els.tabRegister.onclick = () => {
      this.els.tabRegister.classList.add("active");
      this.els.tabLogin.classList.remove("active");
      this.els.registerForm.classList.remove("hidden");
      this.els.loginForm.classList.add("hidden");
    };
  },
  bindAuth() {
    this.els.registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(this.els.registerForm);
      const res = await fetch("/api/register", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(Object.fromEntries(fd)) });
      const j = await res.json();
      if (j.ok) this.afterLogin();
      else alert(j.error || "Register failed");
    });
    this.els.loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(this.els.loginForm);
      const payload = Object.fromEntries(fd);
      payload.remember = !!payload.remember;
      const res = await fetch("/api/login", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (j.ok) this.afterLogin(); else alert(j.error || "Login failed");
    });
  },
  async afterLogin() {
    const me = await api.me();
    state.me = me;
    this.els.meAvatar.src = me.avatar_url || "/public/default-avatar.png";
    this.els.meUsername.textContent = me.username;
    this.els.setUsername.value = me.username;
    this.els.setAvatar.value = me.avatar_url || "";
    this.els.setBio.value = me.bio || "";

    this.els.authPanel.classList.add("hidden");
    this.els.chatLayout.classList.remove("hidden");

    // socket connect
    state.socket = window.io && window.io() || null;
    if (!state.socket) {
      alert("Socket.IO client not loaded"); return;
    }
    state.socket.on("connect", () => {});
    state.socket.on("msg:new", (msg) => {
      ui.renderMessage(msg);
      ui.playPingIfNeeded(msg);
    });
    state.socket.on("typing", (t) => {
      // could render typing indicator
    });

    await this.refreshSidebars();
  },
  bindActions() {
    this.els.openSettings.onclick = () => this.toggleSettings(true);
    this.els.closeSettings.onclick = () => this.toggleSettings(false);
    this.els.saveSettings.onclick = async () => {
      await api.saveSettings({
        username: this.els.setUsername.value.trim(),
        avatar_url: this.els.setAvatar.value.trim(),
        bio: this.els.setBio.value.trim()
      });
      const me = await api.me();
      state.me = me;
      this.els.meAvatar.src = me.avatar_url || "/public/default-avatar.png";
      this.els.meUsername.textContent = me.username;
      this.toggleSettings(false);
    };

    this.els.addFriendBtn.onclick = async () => {
      const u = this.els.addFriendInput.value.trim();
      if (!u) return;
      const r = await api.addFriend(u);
      if (!r.ok) alert(r.error || "Failed");
      this.els.addFriendInput.value = "";
      await this.refreshFriends();
    };

    this.els.createGroup.onclick = async () => {
      const name = this.els.newGroupName.value.trim();
      if (!name) return;
      await api.createGroup(name);
      this.els.newGroupName.value = "";
      await this.refreshGroups();
    };

    this.els.sendBtn.onclick = () => this.sendMessage();
    this.els.messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault(); this.sendMessage();
      } else {
        if (state.socket && state.context.room) state.socket.emit("typing", { room: state.context.room });
      }
    });

    this.els.fileInput.addEventListener("change", () => this.handleFiles());

    // VC
    this.els.vcJoin.onclick = () => webrtc.join(this.els.vcRoom.value || state.context.room || "lobby");
    this.els.vcLeave.onclick = () => webrtc.leave();
    this.els.vcMute.onclick = () => webrtc.toggleMute();

    // Emoji
    this.els.emojiBtn.onclick = () => this.els.emojiPicker.classList.toggle("hidden");
  },
  async refreshSidebars() {
    await this.refreshFriends();
    await this.refreshGroups();
  },
  async refreshFriends() {
    const data = await api.friends();
    this.els.friendsList.innerHTML = "";
    data.friends.forEach(f => {
      const li = document.createElement("li");
      li.textContent = f.username;
      li.onclick = () => this.openDM(f);
      this.els.friendsList.appendChild(li);
    });
  },
  async refreshGroups() {
    const data = await api.myGroups();
    this.els.groupsList.innerHTML = "";
    data.groups.forEach(g => {
      const li = document.createElement("li");
      li.innerHTML = `<div class="bold">${g.name}</div><div class="small">Channels: ${JSON.parse(g.channels || "[]").length}</div>`;
      li.onclick = () => this.openGroup(g);
      this.els.groupsList.appendChild(li);
    });
  },
  async openDM(friend) {
    state.context = { type: "direct", target_id: friend.id, channel_id: null, room: `user:${friend.id}`, title: `DM: ${friend.username}` };
    this.els.contextTitle.textContent = state.context.title;
    state.socket.emit("room:join", { room: state.context.room });
    const hist = await api.history({ type:"direct", target_id: friend.id });
    this.renderHistory(hist.messages);
  },
  async openGroup(g) {
    // open a modal to show channels and invite
    const members = JSON.parse(g.members || "[]");
    const channels = JSON.parse(g.channels || "[]");
    this.els.groupOps.innerHTML = `
      <div><b>${g.name}</b></div>
      <div>Members: ${members.map(m=>m.username).join(", ")}</div>
      <div class="row"><input id="inviteUser" placeholder="Invite username"><button id="inviteBtn">Invite</button></div>
      <div class="row"><input id="newChan" placeholder="New channel name"><button id="addChanBtn">Add</button></div>
      <div>Channels:</div>
      <ul>${channels.map(c=>`<li><button class="openChan" data-id="${c.id}"># ${c.name}</button></li>`).join("")}</ul>
    `;
    this.toggleGroup(true);
    this.els.groupOps.querySelector("#inviteBtn").onclick = async () => {
      const u = this.els.groupOps.querySelector("#inviteUser").value.trim();
      if (!u) return;
      await api.groupInvite(g.id, u);
      await ui.refreshGroups();
      alert("Invited!");
    };
    this.els.groupOps.querySelector("#addChanBtn").onclick = async () => {
      const n = this.els.groupOps.querySelector("#newChan").value.trim();
      if (!n) return;
      const r = await api.createChannel(g.id, n);
      await ui.refreshGroups();
      alert("Channel created");
    };
    this.els.groupOps.querySelectorAll(".openChan").forEach(btn => {
      btn.onclick = async () => {
        const channel_id = Number(btn.dataset.id);
        state.context = { type: "channel", target_id: null, channel_id, room: `channel:${channel_id}`, title: `#${btn.textContent.replace('# ','')}` };
        this.els.contextTitle.textContent = state.context.title;
        state.socket.emit("room:join", { room: state.context.room });
        const hist = await api.history({ type:"channel", channel_id });
        this.renderHistory(hist.messages);
        this.toggleGroup(false);
      };
    });
    document.getElementById("closeGroup").onclick = () => this.toggleGroup(false);
  },
  toggleSettings(show) {
    this.els.settingsModal.classList.toggle("hidden", !show);
  },
  toggleGroup(show) {
    this.els.groupModal.classList.toggle("hidden", !show);
  },
  async sendMessage() {
    if (!state.context.type) { alert("Open a DM or channel first"); return; }
    const text = this.els.messageInput.value.trim();
    const attachments = this.pendingAttachments || [];
    if (!text && attachments.length === 0) return;

    const payload = { type: state.context.type, target_id: state.context.target_id, channel_id: state.context.channel_id, text, attachments };
    this.els.messageInput.value = "";
    this.pendingAttachments = [];

    const res = await api.sendMessage(payload);
    if (!res.ok) alert(res.error || "Failed");

    // local history refresh: optional; messages are pushed via socket too
  },
  async handleFiles() {
    const files = this.els.fileInput.files;
    if (!files || files.length === 0) return;
    const fd = new FormData();
    for (const f of files) fd.append("files", f, f.webkitRelativePath || f.name);
    const res = await fetch("/api/upload", { method:"POST", body: fd });
    const j = await res.json();
    if (!j.ok) { alert(j.error || "Upload failed"); return; }
    this.pendingAttachments = (this.pendingAttachments || []).concat(j.files);
    // show previews in composer? keep simple: append filenames
    this.els.messageInput.value += (this.els.messageInput.value ? "\n" : "") + j.files.map(f => `[file] ${f.original}`).join("\n");
    this.els.fileInput.value = "";
  },
  renderHistory(messages) {
    this.els.messages.innerHTML = "";
    messages.forEach(m => this.renderMessage({
      id: m.id,
      type: m.type,
      sender: { id: m.sender_id, username: m.username, avatar_url: m.avatar_url },
      content: m.content,
      attachments: JSON.parse(m.attachments_json || "[]"),
      created_at: m.created_at
    }));
    this.scrollBottom();
  },
  renderMessage(msg) {
    const wrap = document.createElement("div");
    wrap.className = "msg" + (msg.sender?.id === state.me.id ? " me" : "");
    const avatar = document.createElement("img");
    avatar.className = "avatar";
    avatar.src = msg.sender?.avatar_url || "/public/default-avatar.png";
    avatar.alt = "avatar";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    const meta = document.createElement("div");
    meta.className = "meta";
    const time = new Date(msg.created_at || Date.now()).toLocaleString();
    meta.textContent = `${msg.sender?.username || "Unknown"} • ${time}`;
    bubble.appendChild(meta);

    if (msg.content) {
      const p = document.createElement("div");
      p.textContent = msg.content;
      bubble.appendChild(p);
    }

    if (msg.attachments && msg.attachments.length) {
      // images inline, other files as links
      msg.attachments.forEach(a => {
        if (a.mimetype && a.mimetype.startsWith("image/")) {
          const img = document.createElement("img");
          img.src = a.url;
          img.className = "attachment";
          img.loading = "lazy";
          bubble.appendChild(img);
        } else {
          const files = document.createElement("div");
          files.className = "files";
          const link = document.createElement("a");
          link.href = a.url;
          link.download = a.original;
          link.textContent = `Download ${a.original} (${Math.round((a.size||0)/1024)} KB)`;
          files.appendChild(link);
          bubble.appendChild(files);
        }
      });
    }

    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
    this.els.messages.appendChild(wrap);
    this.scrollBottom();
  },
  scrollBottom() {
    this.els.messages.scrollTop = this.els.messages.scrollHeight;
  },
  playPingIfNeeded(msg) {
    // Play ping on any message not from me
    if (msg.sender?.id !== state.me.id) {
      this.pingSound();
    }
  },
  renderEmojiPicker() {
    const picker = this.els.emojiPicker;
    const grid = document.createElement("div");
    grid.className = "emoji-grid";
    (window.EMOJI || []).forEach(e => {
      const b = document.createElement("button");
      b.className = "emoji";
      b.textContent = e;
      b.onclick = () => {
        this.els.messageInput.value += e;
        this.els.emojiPicker.classList.add("hidden");
      };
      grid.appendChild(b);
    });
    picker.innerHTML = "";
    picker.appendChild(grid);
  },
  makePing() {
    // WebAudio ping (no file needed)
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    return () => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(880, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.12);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.26);
    };
  }
};

export const api = {
  init() {},
  async me() {
    const r = await fetch("/api/me"); const j = await r.json();
    return j.user;
  },
  async saveSettings(data) {
    const r = await fetch("/api/settings/profile", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(data) });
    return r.json();
  },
  async friends() {
    const r = await fetch("/api/friends/list"); return r.json();
  },
  async addFriend(username) {
    const r = await fetch("/api/friends/add", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ username }) });
    return r.json();
  },
  async createGroup(name) {
    const r = await fetch("/api/groups/create", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ name }) });
    return r.json();
  },
  async groupInvite(groupId, username) {
    const r = await fetch(`/api/groups/${groupId}/invite`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ username }) });
    return r.json();
  },
  async createChannel(groupId, name) {
    const r = await fetch(`/api/groups/${groupId}/channels/create`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ name }) });
    return r.json();
  },
  async myGroups() {
    const r = await fetch("/api/groups/my"); return r.json();
  },
  async sendMessage(payload) {
    const r = await fetch("/api/messages/send", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
    return r.json();
  },
  async history(q) {
    const u = new URLSearchParams(q).toString();
    const r = await fetch(`/api/messages/history?${u}`);
    return r.json();
  }
};

export const webrtc = {
  init() {
    state.socket?.on?.("voice:peer-joined", ({ userId }) => {
      // could show UI presence
    });
    if (state.socket) {
      state.socket.on("voice:signal", async ({ from, data }) => {
        const pc = this.ensurePC(from);
        if (data.type === "offer") {
          await pc.setRemoteDescription(data);
          if (!state.stream) {
            state.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          }
          state.stream.getTracks().forEach(t => pc.addTrack(t, state.stream));
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          state.socket.emit("voice:signal", { room: this.room, data: pc.localDescription, to: from });
        } else if (data.type === "answer") {
          await pc.setRemoteDescription(data);
        } else if (data.candidate) {
          try { await pc.addIceCandidate(data); } catch(e){}
        }
      });
    }
    this.peers = new Map();
  },
  ensurePC(id) {
    if (this.peers.has(id)) return this.peers.get(id);
    const pc = new RTCPeerConnection({ iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }] });
    pc.onicecandidate = e => {
      if (e.candidate) state.socket.emit("voice:signal", { room: this.room, data: e.candidate, to: id });
    };
    pc.ontrack = e => {
      let audio = document.getElementById(`audio-${id}`);
      if (!audio) {
        audio = document.createElement("audio");
        audio.id = `audio-${id}`;
        audio.autoplay = true;
        document.body.appendChild(audio);
      }
      audio.srcObject = e.streams[0];
    };
    this.peers.set(id, pc);
    return pc;
  },
  async join(room) {
    this.room = room;
    if (!state.stream) {
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    state.socket.emit("voice:join", { room });
    // Create offers to existing peers by sending a broadcast offer; peers will respond
    const pc = this.ensurePC("broadcast");
    state.stream.getTracks().forEach(t => pc.addTrack(t, state.stream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    state.socket.emit("voice:signal", { room, data: pc.localDescription });
  },
  leave() {
    state.socket.emit("voice:leave", { room: this.room });
    this.peers.forEach((pc, id) => pc.close());
    this.peers.clear();
    this.room = null;
  },
  toggleMute() {
    if (!state.stream) return;
    const track = state.stream.getAudioTracks()[0];
    if (track) track.enabled = !track.enabled;
    alert(track.enabled ? "Unmuted" : "Muted");
  }
};
