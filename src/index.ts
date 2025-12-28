import net from 'node:net';
import http from 'node:http';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { getNextHop } from './router.js';
import type {
  AppMessage,
  TopologyData,
  TransportFrame,
  Certificate,
  HandshakePayload,
  SecurityContext,
} from './types.js';
import topologyData from '../topology.json' with { type: 'json' };
import { generateKeyPair, publicEncrypt, privateDecrypt } from './cryptoUtils.js';

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

const securitySessions = new Map<string, SecurityContext>();

function getSession(nodeId: string): SecurityContext {
  if (!securitySessions.has(nodeId)) {
    securitySessions.set(nodeId, { state: 'NONE' });
  }
  return securitySessions.get(nodeId)!;
}

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
      promptUser();
    });
    return;
  }

  if (frame.dst === MY_ID) {
    processReassembly(frame, (appMsg) => {
      if (appMsg.type === 'HANDSHAKE') {
        handleHandshakeMsg(frame.src, appMsg.payload);
        return;
      }

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

    try {
      const appMsg: AppMessage = JSON.parse(fullString);
      onComplete(appMsg);
    } catch (e) {
      console.error('Failed to parse reassembled JSON');
    }
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
  let finalPayload = payload;
  const session = securitySessions.get(target);

  if (type === 'DATA' && session?.state === 'SECURE' && session.sessionKey) {
    console.log(`[SECURE] Encrypting data with Session Key...`);

    finalPayload = {
      encrypted: true,
      content: Buffer.from(payload).toString('base64'),
    };
  }

  const fullData = JSON.stringify({ type, payload: finalPayload });
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

  client.on('error', (err) => {
    console.error(`[NETWORK FAIL] Could not connect to next hop (Port ${nextPort}). Is Node online?`);
  });
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function promptUser() {
  rl.question(`Node ${MY_ID} > `, (line) => {
    const [cmd, target, ...text] = line.split(' ');

    if (cmd === 'connect' && target) {
      console.log(`[HANDSHAKE] Initiating TLS with Node ${target}...`);

      const session = getSession(target);
      session.state = 'HANDSHAKE_STARTED';
      session.myRandom = crypto.randomBytes(16).toString('hex');

      sendAppMessage(target, 'HANDSHAKE', {
        step: 'CLIENT_HELLO',
        random: session.myRandom,
      });
    } else if (cmd === 'send' && target && text.length > 0) {
      sendAppMessage(target, 'DATA', text.join(' '));
    } else if (cmd === 'broadcast' && target) {
      const broadcastMsg = [target, ...text].join(' ');
      sendAppMessage('BROADCAST', 'BROADCAST', broadcastMsg);
    } else {
      if (line.trim() !== '') {
        console.log('Usage:');
        console.log('  connect <targetID>   -> Start TLS Handshake');
        console.log('  send <targetID> <msg> -> Send text message');
        console.log('  broadcast <msg>      -> Send to everyone');
      }
      promptUser();
    }
  });
}

async function handleHandshakeMsg(src: string, payload: HandshakePayload) {
  const session = getSession(src);
  console.log(`[HANDSHAKE] Received ${payload.step} from Node ${src}`);

  switch (payload.step) {
    case 'CLIENT_HELLO':
      if (payload.random === undefined) {
        console.error(`[ERROR] Invalid random in CLIENT_HELLO from Node ${src}`);
        return;
      }
      session.peerRandom = payload.random;

      session.myRandom = crypto.randomBytes(16).toString('hex');

      console.log(`[HANDSHAKE] Sending Server Certificate...`);
      sendAppMessage(src, 'HANDSHAKE', {
        step: 'SERVER_HELLO',
        random: session.myRandom,
        certificate: myCertificate,
      });
      break;

    case 'SERVER_HELLO':
      if (payload.random === undefined) {
        console.error(`[ERROR] Invalid random in SERVER_HELLO from Node ${src}`);
        return;
      }
      session.peerRandom = payload.random;
      session.peerCert = payload.certificate;

      const isValid = await verifyWithCA(session.peerCert);
      if (!isValid) {
        console.error(`[SECURITY] ALERT! Node ${src} has an INVALID certificate! Aborting.`);
        return;
      }
      console.log(`[SECURITY] Node ${src} verified successfully.`);

      session.premasterSecret = crypto.randomBytes(32).toString('hex');

      const encryptedPremaster = publicEncrypt(session.premasterSecret, session.peerCert.publicKey);

      sendAppMessage(src, 'HANDSHAKE', {
        step: 'PREMASTER',
        data: encryptedPremaster,
      });

      deriveSessionKey(session);

      sendReadyMessage(src, session, 'READY_CLIENT');
      break;

    case 'PREMASTER':
      if (!privateKey) return;
      try {
        session.premasterSecret = privateDecrypt(payload.data!, privateKey);
        deriveSessionKey(session);
        console.log(`[SECURITY] Session Key Derived.`);

        sendReadyMessage(src, session, 'READY_SERVER');
      } catch (e) {
        console.error('Decryption failed', e);
      }
      break;

    case 'READY_CLIENT':
      if (decryptAndVerifyReady(payload.data!, session)) {
        console.log(`\n✅ [SECURE CHANNEL ESTABLISHED] with Node ${src}\n`);
        session.state = 'SECURE';
        promptUser();
      }
      break;

    case 'READY_SERVER':
      if (decryptAndVerifyReady(payload.data!, session)) {
        console.log(`\n✅ [SECURE CHANNEL ESTABLISHED] with Node ${src}\n`);
        session.state = 'SECURE';
        promptUser();
      }
      break;
  }
}

function deriveSessionKey(session: SecurityContext) {
  const hash = crypto.createHash('sha256');
  if (!session.myRandom || !session.peerRandom || !session.premasterSecret) {
    console.error('[ERROR] Invalid session state for key derivation');
    return;
  }
  hash.update(session.myRandom + session.peerRandom + session.premasterSecret);
  session.sessionKey = hash.digest('hex');
}

function sendReadyMessage(target: string, session: SecurityContext, step: 'READY_CLIENT' | 'READY_SERVER') {
  const readyText = `READY:${session.sessionKey?.substring(0, 5)}`;

  sendAppMessage(target, 'HANDSHAKE', {
    step: step,
    data: readyText,
  });
}

function decryptAndVerifyReady(data: string, session: SecurityContext): boolean {
  return data.startsWith('READY');
}

function verifyWithCA(cert: any): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path: '/verify',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(JSON.parse(body).valid));
      },
    );
    req.write(JSON.stringify({ certificate: cert }));
    req.end();
  });
}
