import net from "node:net"; 
import config from "./config/index.js"; 
import { createRoom } from "./service/discovery.js"; 
import { createSecureChannel } from "./events/tcpEvents.js"; 

export const startReceiver = (roomName, onChannel, port = config.network.defaultPort) => 
    new Promise((resolve, reject) => {
        const server = net.createServer((socket) =>{
            onChannel(createSecureChannel(socket)); 
        }); 

        server.once("error", reject); 

        server.listen(port, config.network.host, async () => {
            try{
                await createRoom(roomName, port); 
                resolve(server); 
            }catch (err) {
                server.close(); 
                reject(err); 
            }
        }); 
    }); 
    
    
    
    