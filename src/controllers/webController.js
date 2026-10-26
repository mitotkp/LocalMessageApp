import { EventEmitter } from "node:events";
import { startReceiver } from "../receiver.js";
import { joinRoom } from "../transmittor.js";
import { searchRooms, unpublishRooms } from "../service/discovery.js";
import { createMessage, serializeMessage, parseMessage } from "../models/messageModel.js";

const MAX_HISTORY = 200;

export const httpError = (status, message) => Object.assign(new Error(message), { status });

// Same chat flow as ChatController, but driven by the browser instead of the terminal.
// Every change is emitted as an "update" event, which the web server forwards to the page.
export class WebChatController extends EventEmitter {
    #nick = "";
    #mode = "idle"; // idle | hosting | joined
    #roomName = "";
    #server = null;
    #channel = null;
    #peer = null;
    #rooms = new Map();
    #history = [];
    #busy = false;

    get state() {
        return {
            nick: this.#nick,
            mode: this.#mode,
            roomName: this.#roomName,
            peer: this.#peer,
            history: this.#history,
        };
    }

    async createRoom(nick, roomName) {
        await this.#exclusive(async () => {
            this.#assertIdle();
            this.#nick = this.#validateNick(nick);
            const name = String(roomName ?? "").trim().slice(0, 60) || `${this.#nick}'s room`;

            try {
                this.#server = await startReceiver(name, (channel) => this.#attach(channel));
            } catch (err) {
                throw httpError(500, `Could not create the room: ${err.message}`);
            }

            this.#mode = "hosting";
            this.#roomName = name;
            this.#history = [];
            this.#addSystem(`Room "${name}" created. Waiting for someone to join...`);
            this.#emitState();
        });
    }

    async searchRooms() {
        const rooms = await searchRooms();
        this.#rooms = new Map(rooms.map((room, i) => [String(i + 1), room]));
        return [...this.#rooms].map(([id, room]) => ({ id, name: room.name, host: room.host }));
    }

    async joinRoom(nick, roomId) {
        await this.#exclusive(async () => {
            this.#assertIdle();
            this.#nick = this.#validateNick(nick);

            const room = this.#rooms.get(String(roomId));
            if (!room) throw httpError(404, "That room is no longer listed. Search again.");

            let channel;
            try {
                channel = await joinRoom(room);
            } catch (err) {
                throw httpError(502, err.message);
            }

            this.#mode = "joined";
            this.#roomName = room.name;
            this.#history = [];
            this.#attach(channel);
            this.#peer = channel.remote; // joinRoom already waited for the key exchange
            this.#addSystem(`Connected to "${room.name}".`);
            this.#emitState();
        });
    }

    send(text) {
        const clean = String(text ?? "").trim();
        if (!clean) throw httpError(400, "The message is empty.");
        if (!this.#channel || !this.#peer) throw httpError(409, "Nobody is connected yet.");

        const message = createMessage({ author: this.#nick, text: clean });
        this.#channel.send(serializeMessage(message));
        this.#addEntry({ kind: "message", own: true, ...message });
    }

    async leave() {
        await this.#exclusive(async () => {
            if (this.#mode === "idle") return;

            this.#channel?.close();
            this.#channel = null;

            if (this.#server) {
                this.#server.close();
                this.#server = null;
                await unpublishRooms();
            }

            this.#mode = "idle";
            this.#roomName = "";
            this.#peer = null;
            this.#history = [];
            this.#emitState();
        });
    }

    #attach(channel) {
        // Private 1-to-1 chat: if someone is already connected, the newcomer is rejected
        if (this.#channel) {
            channel.on("error", () => {});
            channel.close();
            return;
        }

        this.#channel = channel;

        channel.on("ready", () => {
            this.#peer = channel.remote;
            this.#addSystem(`Someone connected from ${channel.remote}.`);
            this.#emitState();
        });

        channel.on("message", (raw) => {
            const message = parseMessage(raw);
            if (message) this.#addEntry({ kind: "message", own: false, ...message });
        });

        channel.on("warning", () => this.#addSystem("An invalid message was discarded."));

        channel.on("error", (err) => {
            // ECONNRESET = the other side closed the program abruptly; reported through the "close" event
            if (err.code !== "ECONNRESET") this.#addSystem(`Connection error: ${err.message}`);
        });

        channel.on("close", () => {
            if (this.#channel !== channel) return; // already handled by leave()
            this.#channel = null;
            this.#peer = null;
            this.#addSystem(this.#mode === "hosting"
                ? "The other person disconnected. Waiting for someone else..."
                : "The other person disconnected.");
            this.#emitState();
        });
    }

    #validateNick(nick) {
        const clean = String(nick ?? "").trim().slice(0, 32);
        if (!clean) throw httpError(400, "Enter a nickname first.");
        return clean;
    }

    #assertIdle() {
        if (this.#mode !== "idle") throw httpError(409, "Leave the current room first.");
    }

    // Prevents two clicks in a row from creating or joining two rooms at the same time
    async #exclusive(task) {
        if (this.#busy) throw httpError(409, "Another action is still in progress.");
        this.#busy = true;
        try {
            await task();
        } finally {
            this.#busy = false;
        }
    }

    #addSystem(text) {
        this.#addEntry({ kind: "system", text, sentAt: new Date().toISOString() });
    }

    #addEntry(entry) {
        this.#history.push(entry);
        if (this.#history.length > MAX_HISTORY) this.#history.shift();
        this.emit("update", { type: "entry", entry });
    }

    #emitState() {
        this.emit("update", { type: "state", state: this.state });
    }
}
