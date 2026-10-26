import { WebChatController } from "./controllers/webController.js";
import { startWebServer } from "./webServer.js";
import { shutdown } from "./service/discovery.js";

const port = Number(process.env.WEB_PORT) || 3000;

const controller = new WebChatController();
const server = await startWebServer(controller, port);

console.log(`LocalMessage is running. Open http://localhost:${port} in your browser.`);
console.log("Press Ctrl+C to stop.");

const stop = async () => {
    await controller.leave().catch(() => {});
    server.close();
    await shutdown();
    process.exit(0);
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
