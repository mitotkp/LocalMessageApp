import net from "node:net"; 
import os from "node:os"; 
import { once } from "node:events"; 
import { createSecureChannel } from "./events/tcpEvents.js"; 

const ipToInt = (ip) => ip.split(".").reduce((acc, octet) => (acc <<
     8) + Number(octet), 0) >>> 0; 

const isInLocalSubnet = (address) => 
    Object.values(os.networkInterfaces()).flat().some((iface) => 
        iface.family === "IPv4" && !iface.internal &&
        ((ipToInt(iface.address) & ipToInt(iface.netmask)) >>> 0) ===
        ((ipToInt(address) & ipToInt(iface.netmask)) >>> 0)
    );
    
const sortCandidates = (addresses) => addresses
    .filter((address) => net.isIPv4(address) && !address.startsWith("169.254."))
    .sort((a, b) => isInLocalSubnet(b) - isInLocalSubnet(a)); 

const connectTo = (host, port, timeout) => new Promise((resolve, reject) => {
    const socket = net.connect({ host, port }); 
    const timer = setTimeout(() => socket.destroy(new 
        Error("Connection Timeout")), timeout);
        
        socket.once("connect", () => {
            clearTimeout(timer); 
            socket.removeAllListeners("error"); 
            resolve(socket); 
        });
        socket.once("error", (err) => {
            clearTimeout(timer); 
            reject(err); 
        }); 
    }); 

export const joinRoom = async (room, timeout = 2000) => {
    for (const address of sortCandidates(room.addresses)) {
        try {
            const socket = await connectTo(address, room.port, timeout);
            const channel = createSecureChannel(socket);
            await once(channel, "ready");
            return channel;
        } catch {
            
        }
    }

    throw new Error(`Could not connect to room "${room.name}"`);
};
    
    
    
