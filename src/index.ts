import net from 'net';
import readline from 'readline';
import { getNextHop } from './router.js';
import type { NetworkMessage, TopologyData } from './types.js';
import topologyData from '../topology.json' with { type: "json" };

const topology = (topologyData as TopologyData).nodes;
const rawId = process.argv[2];
if (!rawId || !topology[rawId]) {
    console.error(`Error: Node ID "${rawId}" not found in topology.json`);
    process.exit(1);
}
const MY_ID = rawId;


const myNodeConfig = topology[MY_ID];
if (!myNodeConfig) {
    throw new Error(`Critical: Node config for ${MY_ID} is undefined`);
}
const MY_PORT = myNodeConfig.port;

const server = net.createServer((socket) => {
    socket.on('data', (data) => {
        try {
            const message: NetworkMessage = JSON.parse(data.toString());
            handleIncomingMessage(message);
        } catch (e) {
            console.error('Failed to parse incoming message');
        }
    });
});

server.listen(MY_PORT, () => {
    console.log(`[Node ${MY_ID}] Online on port ${MY_PORT}`);
    console.log(`[Node ${MY_ID}] Neighbors: ${myNodeConfig.neighbors.join(', ')}`);
    promptUser();
});

function handleIncomingMessage(msg: NetworkMessage) {
    if (msg.target === MY_ID) {
        console.log(`\n>>> [RECEIVED] From Node ${msg.source}: ${JSON.stringify(msg.payload)}`);
        promptUser();
    } else {
        console.log(`\n[ROUTING] Packet for Node ${msg.target} (via me)`);
        forwardPacket(msg);
    }
}

function forwardPacket(msg: NetworkMessage) {
    const nextHop = getNextHop(MY_ID, msg.target);

    if (!nextHop) {
        console.error(`[ERROR] No route to Node ${msg.target} from ${MY_ID}`);
        promptUser();
        return;
    }

    const nextNodeConfig = topology[nextHop];
    if (!nextNodeConfig) {
        console.error(`[ERROR] Invalid next hop node: ${nextHop}`);
        return;
    }
    const nextPort = nextNodeConfig.port;
    const client = net.createConnection({ port: nextPort }, () => {
        client.write(JSON.stringify(msg));
        client.end();
    });

    client.on('error', (err) => {
        console.error(`[ERROR] Failed to connect to neighbor ${nextHop}: ${err.message}`);
    });
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function promptUser() {
    rl.question(`Node ${MY_ID} > `, (line) => {
        const [command, target, ...text] = line.split(' ');

        if (command === 'send' && target && text.length > 0) {
            const msg: NetworkMessage = {
                source: MY_ID,
                target: target,
                type: 'DATA',
                payload: text.join(' ')
            };
            console.log(`[SENDING] To Node ${target}...`);
            forwardPacket(msg);
        } else {
            console.log('Usage: send <targetID> <message>');
            promptUser();
        }
    });
}
