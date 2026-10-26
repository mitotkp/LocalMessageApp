import { EventEmitter } from "node:events"; 
import { EncryptionService } from "../service/encryption.js";

const MAX_LINE = 64 * 1024; 

export const createSecureChannel = (socket) => {
    const channel = new EventEmitter(); 
    const crypto = new EncryptionService(); 

    let buffer = ""; 
    let ready = false; 

    const sendFrame = (frame) => socket.write(JSON.stringify(frame) + "\n"); 

    const handleFrame = (frame) => {
        if(frame.type === "key"){
            if(ready) return;
            crypto.createOtherUserKey(frame.publicKey); 
            ready = true; 
            channel.emit("ready"); 
        } else if (frame.type === "msg") {
            if(!ready) throw new Error("Message received before key exchange"); 
            channel.emit("message", crypto.decryptMessage(frame.encryptMessage, frame.nonce)); 
        }
    }; 
    
    socket.setEncoding("utf8"); 
    socket.on("data", (chunk) => {
        buffer += chunk; 

        let end;
        while((end = buffer.indexOf("\n")) !== -1){
            const line = buffer.slice(0, end); 
            buffer = buffer.slice(end + 1); 
            if(!line) continue;

            try{
                handleFrame(JSON.parse(line)); 
            }catch(err){
                channel.emit("warning", err); 
            }
        }

        if(buffer.length > MAX_LINE) {
            socket.destroy(new Error("Frame too large")); 
        }
    }); 
    
    socket.on("error", (err) => channel.emit("error", err));
    socket.on("close", () => channel.emit("close")); 

    channel.remote = `${socket.remoteAddress}:${socket.remotePort}`; 

    channel.send = (text) => {
        if(!ready) throw new Error("Key exchange not finished"); 
        sendFrame({ type: "msg", ...crypto.encryptMessage(text) }); 
    }; 

    channel.close = () => socket.end(); 

    sendFrame({ type: "key", publicKey: crypto.generateKey() }); 

    return channel; 
}; 








