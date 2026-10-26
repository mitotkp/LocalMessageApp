const MAX_AUTHOR = 32;
const MAX_TEXT = 2000;

// Strips control characters so the other side cannot send ANSI sequences that tamper with the terminal
const clean = (value, max) => String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, max);

export const createMessage = ({ author, text, sentAt = new Date().toISOString() }) => ({
    author: clean(author, MAX_AUTHOR),
    text: clean(text, MAX_TEXT),
    sentAt,
});

export const serializeMessage = (message) => JSON.stringify(message);

export const parseMessage = (raw) => {
    try {
        const data = JSON.parse(raw);
        if (typeof data?.author !== "string" || typeof data?.text !== "string") return null;

        const date = new Date(data.sentAt);
        const sentAt = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();

        return createMessage({ author: data.author, text: data.text, sentAt });
    } catch {
        return null;
    }
};

export const formatMessage = (message) => {
    const time = new Date(message.sentAt).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
    return `[${time}] ${message.author}: ${message.text}`;
};
