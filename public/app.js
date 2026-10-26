const $ = (id) => document.getElementById(id);

const els = {
    status: $("status"),
    statusText: $("status-text"),
    setupView: $("setup-view"),
    chatView: $("chat-view"),
    nick: $("nick"),
    createForm: $("create-form"),
    roomName: $("room-name"),
    searchBtn: $("search-btn"),
    roomList: $("room-list"),
    setupError: $("setup-error"),
    roomTitle: $("room-title"),
    peerInfo: $("peer-info"),
    leaveBtn: $("leave-btn"),
    messages: $("messages"),
    composer: $("composer"),
    composerPrompt: $("composer-prompt"),
    messageInput: $("message-input"),
    chatError: $("chat-error"),
};

let state = null;

// ---------- Server communication ----------

const api = async (method, url, body) => {
    const options = { method };
    if (method !== "GET") {
        options.headers = { "Content-Type": "application/json" };
        options.body = JSON.stringify(body ?? {});
    }

    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
};

const showError = (el, message) => {
    el.textContent = message;
    el.hidden = !message;
};

// Disables the button while the request runs, so it cannot be sent twice.
// busyLabel replaces the button text meanwhile, e.g. "[ SCANNING... ]"
const withBusy = async (button, busyLabel, task) => {
    const label = button.textContent;
    button.disabled = true;
    if (busyLabel) button.textContent = busyLabel;
    try {
        await task();
    } finally {
        button.disabled = false;
        button.textContent = label;
        render();
    }
};

// ---------- Nickname (remembered in this browser only) ----------

try {
    els.nick.value = localStorage.getItem("nick") ?? "";
} catch {
    // storage blocked: the field simply starts empty
}

els.nick.addEventListener("input", () => {
    try {
        localStorage.setItem("nick", els.nick.value.trim());
    } catch {
        // ignore
    }
});

const requireNick = () => {
    const nick = els.nick.value.trim();
    if (!nick) {
        els.nick.focus();
        throw new Error("Enter a nickname first.");
    }
    return nick;
};

// ---------- Rendering ----------

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Turns "Ana's room" into "anas-room" for the shell-style prompt
const slug = (text) => text.toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ']/g, "") // drops accents and apostrophes
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "room";

const span = (className, text) => {
    const el = document.createElement("span");
    el.className = className;
    el.textContent = text;
    return el;
};

// Everything is inserted with textContent, never innerHTML: a message can never inject HTML or scripts
const renderEntry = (entry) => {
    const li = document.createElement("li");

    if (entry.kind === "system") {
        li.append(span("line-time", `[${time(entry.sentAt)}] `), span("line-system", `*** ${entry.text}`));
        return li;
    }

    if (entry.own) li.className = "own";
    li.append(
        span("line-time", `[${time(entry.sentAt)}] `),
        span("line-author", `<${entry.author}>`),
        document.createTextNode(` ${entry.text}`),
    );
    return li;
};

const isNearBottom = () => {
    const { scrollTop, scrollHeight, clientHeight } = els.messages;
    return scrollHeight - scrollTop - clientHeight < 80;
};

const appendEntry = (entry) => {
    const stick = isNearBottom() || entry.own;
    els.messages.append(renderEntry(entry));
    if (stick) els.messages.scrollTop = els.messages.scrollHeight;
};

const setStatus = (tone, text) => {
    els.status.dataset.tone = tone;
    els.statusText.textContent = text;
};

const render = () => {
    if (!state) return;

    const inRoom = state.mode !== "idle";
    els.setupView.hidden = inRoom;
    els.chatView.hidden = !inRoom;

    if (!inRoom) {
        setStatus("muted", "OFFLINE");
        return;
    }

    const connected = Boolean(state.peer);
    els.roomTitle.textContent = state.roomName;
    els.composerPrompt.textContent = `${slug(state.nick)}@${slug(state.roomName)}:~$`;

    if (connected) {
        setStatus("ok", "ENCRYPTED LINK");
        els.peerInfo.textContent = `${state.mode === "hosting" ? "hosting" : "joined"} · peer ${state.peer}`;
    } else if (state.mode === "hosting") {
        setStatus("wait", "WAITING FOR PEER");
        els.peerInfo.textContent = "room broadcast on the network...";
    } else {
        setStatus("bad", "DISCONNECTED");
        els.peerInfo.textContent = "the other person left. run [ LEAVE ] to go back.";
    }

    els.messageInput.disabled = !connected;
    els.composer.querySelector("button").disabled = !connected;
    els.messageInput.placeholder = connected ? "write a message..." : "no peer connected";
};

const renderHistory = () => {
    els.messages.replaceChildren(...state.history.map(renderEntry));
    els.messages.scrollTop = els.messages.scrollHeight;
};

const emptyRow = (text) => {
    const tr = document.createElement("tr");
    tr.className = "empty";
    const td = document.createElement("td");
    td.colSpan = 3;
    td.textContent = text;
    tr.append(td);
    return tr;
};

const renderRooms = (rooms) => {
    if (rooms.length === 0) {
        els.roomList.replaceChildren(emptyRow("0 rooms found. Make sure the other computer created one."));
        return;
    }

    els.roomList.replaceChildren(...rooms.map((room) => {
        const tr = document.createElement("tr");

        const name = document.createElement("td");
        name.textContent = room.name;
        const host = document.createElement("td");
        host.textContent = room.host;

        const action = document.createElement("td");
        const join = document.createElement("button");
        join.type = "button";
        join.className = "button primary";
        join.textContent = "[ JOIN ]";
        join.addEventListener("click", () => withBusy(join, "[ ... ]", async () => {
            showError(els.setupError, "");
            try {
                await api("POST", "/api/join", { nick: requireNick(), roomId: room.id });
            } catch (err) {
                showError(els.setupError, err.message);
            }
        }));
        action.append(join);

        tr.append(name, host, action);
        return tr;
    }));
};

// ---------- Actions ----------

els.createForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const button = els.createForm.querySelector("button");

    withBusy(button, "[ CREATING... ]", async () => {
        showError(els.setupError, "");
        try {
            await api("POST", "/api/rooms", { nick: requireNick(), roomName: els.roomName.value });
            els.roomName.value = "";
        } catch (err) {
            showError(els.setupError, err.message);
        }
    });
});

els.searchBtn.addEventListener("click", () => {
    withBusy(els.searchBtn, "[ SCANNING... ]", async () => {
        showError(els.setupError, "");
        try {
            renderRooms(await api("GET", "/api/rooms"));
        } catch (err) {
            showError(els.setupError, err.message);
        }
    });
});

els.composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = els.messageInput.value.trim();
    if (!text) return;

    showError(els.chatError, "");
    els.messageInput.value = "";
    try {
        await api("POST", "/api/messages", { text });
    } catch (err) {
        els.messageInput.value = text;
        showError(els.chatError, err.message);
    }
    els.messageInput.focus();
});

els.leaveBtn.addEventListener("click", () => {
    withBusy(els.leaveBtn, null, async () => {
        try {
            await api("POST", "/api/leave");
        } catch (err) {
            showError(els.chatError, err.message);
        }
    });
});

// ---------- Live updates (Server-Sent Events) ----------

const events = new EventSource("/api/events");

events.addEventListener("message", (event) => {
    const update = JSON.parse(event.data);

    if (update.type === "state") {
        const enteredRoom = state?.mode === "idle" && update.state.mode !== "idle";
        state = update.state;
        renderHistory();
        render();
        showError(els.chatError, "");
        if (enteredRoom || state.peer) els.messageInput.focus();
    } else if (update.type === "entry" && state) {
        state.history.push(update.entry);
        appendEntry(update.entry);
    }
});

// EventSource reconnects by itself; this only tells the user what is happening
events.addEventListener("error", () => setStatus("bad", "RECONNECTING..."));
events.addEventListener("open", render);
