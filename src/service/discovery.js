import { Bonjour } from "bonjour-service";
import config from "../config/index.js"

const bonjourInstance = new Bonjour()

export const createRoom = (roomName, port = config.network.defaultPort) =>
  new Promise((resolve, reject) => {
    const service = bonjourInstance.publish({
      name: roomName,
      type: config.discovery.type,
      protocol: config.discovery.protocol,
      port,
      txt: config.discovery.txt,
    });

    service.once("up", () => resolve(service));
    service.once("error", reject);
});

export const searchRooms = (timeout = 3000) => new Promise((resolve) => {
    const rooms = new Map();

    const browser = bonjourInstance.find(
        { type: config.discovery.type, protocol: config.discovery.protocol },
        (service) => {
            if (service.txt?.app !== config.discovery.txt.app) return;
            rooms.set(service.fqdn, {
                name: service.name,
                host: service.host,
                addresses: service.addresses,
                port: service.port,
                version: service.txt?.version,
            });
        }
    );

    setTimeout(() => {
       browser.stop();
       resolve([...rooms.values()])
    }, timeout);
});

export const shutdown = () => new Promise((resolve) => {
    bonjourInstance.unpublishAll(() => {
        bonjourInstance.destroy();
        resolve();
    });
});

// Stops announcing rooms but keeps Bonjour alive, so a new room can be created later
export const unpublishRooms = () => new Promise((resolve) => {
    bonjourInstance.unpublishAll(() => resolve());
});
