export const config = {

    network: {
        host: "0.0.0.0",
        defaultPort: 8089,
    },

    discovery: {
        type: "encrypt-chat",
        protocol: "tcp",
        txt: {
            app: "encrypt-chat-p2p",
            version: "1.0.0"
        }
    },

};

export default config;
