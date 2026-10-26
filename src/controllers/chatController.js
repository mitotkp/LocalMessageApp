import os from "node:os";
import readline from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { startReceiver } from "../receiver.js";
import { joinRoom } from "../transmittor.js";
import { searchRooms, shutdown } from "../service/discovery.js";
import { createMessage, serializeMessage, parseMessage, formatMessage } from "../models/messageModel.js";

export class ChatController {
    #rl = createInterface({ input, output });
    #nick = "";
    #server = null;
    #channel = null;
    #isHost = false;
    #chatting = false;
    #exiting = false;

    async start() {
        this.#nick = (await this.#rl.question("Your nickname: ")).trim() || os.hostname();

        const option = (await this.#rl.question("1) Create room   2) Join a room: ")).trim();
        const ok = option === "1" ? await this.#createRoom() : await this.#joinRoom();
        if (!ok) return this.#exit(1);

        this.#chatting = true;
        this.#rl.setPrompt("> ");
        this.#rl.on("line", (line) => this.#onInput(line));
        this.#rl.on("SIGINT", () => this.#exit());
        this.#rl.prompt();
    }

    async #createRoom() {
        const name = (await this.#rl.question("Room name: ")).trim() || `${this.#nick}'s room`;

        try {
            this.#server = await startReceiver(name, (channel) => this.#attach(channel));
        } catch (err) {
            this.#print(`Could not create the room: ${err.message}`);
            return false;
        }

        this.#isHost = true;
        this.#print(`Room "${name}" created. Waiting for someone to join...`);
        return true;
    }

    async #joinRoom() {
        this.#print("Searching for rooms...");
        const rooms = await searchRooms();

        if (rooms.length === 0) {
            this.#print("No rooms found on the network.");
            return false;
        }

        rooms.forEach((room, i) => this.#print(`${i + 1}) ${room.name}  (${room.host})`));
        const choice = Number(await this.#rl.question("Choose the room number: "));
        const room = rooms[choice - 1];

        if (!room) {
            this.#print("Invalid option.");
            return false;
        }

        try {
            this.#attach(await joinRoom(room));
        } catch (err) {
            this.#print(err.message);
            return false;
        }

        this.#print(`Connected to "${room.name}". Type /exit to quit.`);
        return true;
    }

    #attach(channel) {
        // Private 1-to-1 chat: if someone is already connected, the newcomer is rejected
        if (this.#channel) {
            channel.on("error", () => {});
            channel.close();
            return;
        }

        this.#channel = channel;

        channel.on("ready", () => this.#print(`Someone connected from ${channel.remote}. Type /exit to quit.`));

        channel.on("message", (raw) => {
            const message = parseMessage(raw);
            if (message) this.#print(formatMessage(message));
        });

        channel.on("warning", () => this.#print("(an invalid message was discarded)"));
        channel.on("error", (err) => {
            // ECONNRESET = the other side closed the program abruptly; reported through the "close" event
            if (err.code !== "ECONNRESET") this.#print(`Connection error: ${err.message}`);
        });

        channel.on("close", () => {
            this.#channel = null;
            this.#print("The other person disconnected.");
            if (!this.#isHost) this.#exit();
        });
    }

    #onInput(line) {
        const text = line.trim();

        if (text === "/exit") return this.#exit();
        if (!text) return this.#rl.prompt();

        if (!this.#channel) {
            this.#print("Nobody is connected yet.");
            return;
        }

        try {
            this.#channel.send(serializeMessage(createMessage({ author: this.#nick, text })));
        } catch (err) {
            this.#print(`Could not send: ${err.message}`);
        }
        this.#rl.prompt();
    }

    // Prints without overwriting what the user is typing
    #print(text) {
        readline.clearLine(output, 0);
        readline.cursorTo(output, 0);
        console.log(text);
        if (this.#chatting) this.#rl.prompt(true);
    }

    async #exit(code = 0) {
        // Closing the channel fires "close", which calls #exit again: the second call is ignored
        if (this.#exiting) return;
        this.#exiting = true;

        this.#channel?.close();
        this.#server?.close();
        await shutdown();
        this.#rl.close();
        process.exit(code);
    }
}
