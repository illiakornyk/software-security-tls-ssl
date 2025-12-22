import net from 'net';
import readline from 'readline';
import { v4 as uuidv4 } from 'uuid';
import { getNextHop } from './router.js';
import type { AppMessage, TopologyData, TransportFrame } from './types.js';
import topologyData from '../topology.json' with { type: 'json' };

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
  if (frame.dst === MY_ID) {
    if (!reassemblyBuffer.has(frame.id)) {
      reassemblyBuffer.set(frame.id, { total: frame.total, chunks: new Map() });
      console.log(`[REASSEMBLY] Started receiving msg ${frame.id.substring(0, 4)}... (${frame.total} chunks)`);
    }

    const buffer = reassemblyBuffer.get(frame.id)!;
    buffer.chunks.set(frame.seq, frame.data);

    if (buffer.chunks.size === buffer.total) {
      const fullString = Array.from(buffer.chunks.entries())
        .sort((a, b) => a[0] - b[0])
        .map((entry) => entry[1])
        .join('');

      reassemblyBuffer.delete(frame.id);

      try {
        const appMsg: AppMessage = JSON.parse(fullString);
        console.log(`\n>>> [COMPLETE MESSAGE] From Node ${frame.src}:`, appMsg);
        promptUser();
      } catch (e) {
        console.error('Failed to parse reassembled JSON');
      }
    }
  } else {
    console.log(`[ROUTING] Frame ${frame.seq}/${frame.total} for Node ${frame.dst} (via me)`);
    sendFrameOverWire(frame);
  }
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
