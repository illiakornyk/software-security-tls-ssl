import 'dotenv/config';
import { TransportLayer } from './transport.js';
import { HandshakeManager } from './handshake.js';
import { CLI } from './cli.js';
import type { AppMessage, HandshakePayload } from './types.js';
import { MessageType } from './types.js';
import { BROADCAST_ID } from './constants.js';

const rawId = process.argv[2];
if (!rawId) {
  console.error(`Error: Node ID must be provided as argument.`);
  process.exit(1);
}
const MY_ID = rawId;

async function main() {

  let transport: TransportLayer;
  let handshake: HandshakeManager;
  let cli: CLI;

  handshake = new HandshakeManager(MY_ID, {
    sendAppMessage: (target, type, payload) => {
      transport.sendAppMessage(target, type, payload);
    },
    onSecureChannelEstablished: (targetId) => {
      cli.promptUser();
    },
  });

  transport = new TransportLayer(MY_ID, {
    onFrameReceived: (frame) => {
    },
    onAppMessageReceived: (appMsg: AppMessage, src: string) => {
       if (appMsg.type === MessageType.HANDSHAKE) {
         handshake.handleHandshakeMsg(src, appMsg.payload as HandshakePayload);
       } else if (appMsg.type === MessageType.DATA) {
         const decrypted = handshake.getDecryptedPayload(src, appMsg.payload);
         console.log(`\n>>> [RECEIVED] From Node ${src}:`, decrypted);
         cli.promptUser();
       } else if (appMsg.type === MessageType.BROADCAST) {
         console.log(`\n>>> [BROADCAST RECEIVED] From Node ${src}:`, appMsg.payload);
         cli.promptUser();
       }
    },
  });

  cli = new CLI(MY_ID, {
    onConnect: (target) => {
      handshake.initiateHandshake(target);
    },
    onSend: (target, message) => {
      const payload = handshake.getSecurePayload(target, message);
      transport.sendAppMessage(target, MessageType.DATA, payload);
    },
    onBroadcast: (message) => {
      transport.sendAppMessage(BROADCAST_ID, MessageType.BROADCAST, message);
    },
  });


  try {
    await handshake.registerWithCA();
    transport.startServer();
    cli.start();
  } catch (err) {
    console.error('Failed to initialize:', err);
    process.exit(1);
  }
}

main();
