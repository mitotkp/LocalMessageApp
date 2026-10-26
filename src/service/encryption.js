import nacl from "tweetnacl";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (bytes) => Buffer.from(bytes).toString("base64");
const fromBase64 = (text) => new Uint8Array(Buffer.from(text, "base64"));

export class EncryptionService {
    #personalSecretKey = null;
    #sharedSecret = null;

    generateKey() {
        const { publicKey, secretKey } = nacl.box.keyPair();
        this.#personalSecretKey = secretKey;
        return toBase64(publicKey);
    }

    createOtherUserKey(publicKeyB64) {
        if (!this.#personalSecretKey) {
            throw new Error("No key!!!");
        }

        const publicKey = fromBase64(publicKeyB64);
        if (publicKey.length !== nacl.box.publicKeyLength) {
            throw new Error("not valid key!");
        }

        this.#sharedSecret = nacl.box.before(publicKey, this.#personalSecretKey);
    }

    encryptMessage(plainText) {
        this.#verifySecret();

        const nonce = nacl.randomBytes(nacl.box.nonceLength);
        const bytes = encoder.encode(plainText);
        const encrypted = nacl.box.after(bytes, nonce, this.#sharedSecret);

        return {
            encryptMessage: toBase64(encrypted),
            nonce: toBase64(nonce),
        };
    }

    decryptMessage(encryptMessageB64, nonceB64) {
        this.#verifySecret();

        const bytes = nacl.box.open.after(
            fromBase64(encryptMessageB64),
            fromBase64(nonceB64),
            this.#sharedSecret
        );

        if (bytes === null) {
            throw new Error("This message can´t be decrypted!!!");
        }

        return decoder.decode(bytes);
    }

    #verifySecret() {
        if (!this.#sharedSecret) {
            throw new Error("The other user's key has not yet been established")
        }
    }
}
