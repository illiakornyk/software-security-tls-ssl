import net from 'node:net';
import http from 'node:http';
import readline from 'node:readline';
import { v4 as uuidv4 } from 'uuid';
import { getNextHop } from './router.js';
import type { AppMessage, TopologyData, TransportFrame, Certificate } from './types.js';
import topologyData from '../topology.json' with { type: 'json' };
import { generateKeyPair } from './cryptoUtils.js';

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

const MTU = 128;

const reassemblyBuffer = new Map<string, { total: number; chunks: Map<number, string> }>();

const seenBroadcasts = new Set<string>();

const { publicKey, privateKey } = generateKeyPair();
let myCertificate: Certificate | null = null;
let caPublicKey: string | null = null;

function registerWithCA() {
  const postData = JSON.stringify({ id: MY_ID, publicKey });

  const req = http.request(
    {
      hostname: 'localhost',
      port: 3000,
      path: '/sign',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const response = JSON.parse(data);
        myCertificate = response.certificate;
        caPublicKey = response.caPublicKey;
        console.log(`[CRYPTO] Certificate Signed by CA. Ready.`);
      });
    },
  );

  req.on('error', (e) => {
    console.error(`[CRYPTO] Could not connect to CA: ${e.message}`);
    console.error(`[CRYPTO] Is the CA server running? (npx tsx src/ca.ts)`);
  });

  req.write(postData);
  req.end();
}

registerWithCA();

const server = net.createServer((socket) => {
  socket.on('data', (data) => {
    try {
      const frame: TransportFrame = JSON.parse(data.toString());
      handleFrame(frame);
    } catch (e) {
      console.error('Buffer error (packet overlap or corruption)');
    }
  });
});

server.listen(MY_PORT, () => {
  console.log(`[Node ${MY_ID}] Online on port ${MY_PORT}`);
  console.log(`[Node ${MY_ID}] Neighbors: ${myNodeConfig.neighbors.join(', ')}`);
  promptUser();
});

function handleFrame(frame: TransportFrame) {
  if (frame.dst === 'BROADCAST') {
    if (seenBroadcasts.has(frame.id)) return;
    seenBroadcasts.add(frame.id);

    processReassembly(frame, (appMsg) => {
      console.log(`\n>>> [BROADCAST RECEIVED] From Node ${frame.src}:`, appMsg.payload);
      broadcastToNeighbors(frame);
    });
    return;
  }

  if (frame.dst === MY_ID) {
    processReassembly(frame, (appMsg) => {
      console.log(`\n>>> [RECEIVED] From Node ${frame.src}:`, appMsg.payload);
      promptUser();
    });
  } else {
    console.log(`[ROUTING] Relaying frame ${frame.seq + 1}/${frame.total} for Node ${frame.dst}`);
    sendFrameOverWire(frame);
  }
}
function processReassembly(frame: TransportFrame, onComplete: (msg: AppMessage) => void) {
  if (!reassemblyBuffer.has(frame.id)) {
    reassemblyBuffer.set(frame.id, { total: frame.total, chunks: new Map() });
  }
  const buffer = reassemblyBuffer.get(frame.id)!;
  buffer.chunks.set(frame.seq, frame.data);

  if (buffer.chunks.size === buffer.total) {
    const fullString = Array.from(buffer.chunks.entries())
      .sort((a, b) => a[0] - b[0])
      .map((entry) => entry[1])
      .join('');
    reassemblyBuffer.delete(frame.id);
    onComplete(JSON.parse(fullString));
  }
}

function broadcastToNeighbors(frame: TransportFrame) {
  const myNeighbors = myNodeConfig!.neighbors;
  myNeighbors.forEach((neighborId) => {
    const neighborNode = topology[neighborId];
    if (!neighborNode) {
      console.error(`[ERROR] Invalid neighbor in config: ${neighborId}`);
      return;
    }
    const nextPort = neighborNode.port;
    const client = net.createConnection({ port: nextPort }, () => {
      client.write(JSON.stringify(frame));
      client.end();
    });
    client.on('error', () => {});
  });
}

function sendAppMessage(target: string, type: 'DATA' | 'HANDSHAKE' | 'BROADCAST', payload: any) {
  const fullData = JSON.stringify({ type, payload });
  const msgId = uuidv4();

  const HEADER_OVERHEAD = 90;
  const CHUNK_SIZE = Math.max(10, MTU - HEADER_OVERHEAD);

  const totalFrames = Math.ceil(fullData.length / CHUNK_SIZE);

  console.log(`[FRAGMENTATION] Splitting ${fullData.length} bytes into ${totalFrames} frames...`);

  for (let i = 0; i < totalFrames; i++) {
    const chunk = fullData.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);

    const frame: TransportFrame = {
      id: msgId,
      src: MY_ID,
      dst: target,
      seq: i,
      total: totalFrames,
      data: chunk,
    };

    setTimeout(() => {
      sendFrameOverWire(frame);
    }, i * 100);
  }
}

function sendFrameOverWire(frame: TransportFrame) {
  const nextHop = getNextHop(MY_ID, frame.dst);
  if (!nextHop) return;

  const nextNodeConfig = topology[nextHop];
  if (!nextNodeConfig) {
    console.error(`[ERROR] Invalid next hop node: ${nextHop}`);
    return;
  }
  const nextPort = nextNodeConfig.port;

  const client = net.createConnection({ port: nextPort }, () => {
    client.write(JSON.stringify(frame));
    client.end();
  });

  client.on('error', () => {});
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function promptUser() {
  rl.question(`Node ${MY_ID} > `, (line) => {
    const [cmd, target, ...text] = line.split(' ');
    if (cmd === 'send' && target) {
      sendAppMessage(target, 'DATA', text.join(' '));
    } else {
      promptUser();
    }
  });
}
