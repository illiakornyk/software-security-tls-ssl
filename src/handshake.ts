import http from 'node:http';
import crypto from 'node:crypto';
import 'dotenv/config';
import { generateKeyPair, publicEncrypt, privateDecrypt, symmetricEncrypt, symmetricDecrypt, verifySignature } from './cryptoUtils.js';
import type { Certificate, SecurityContext, HandshakePayload, AppPayload, DataPayload } from './types.js';
import { HandshakeStep, MessageType } from './types.js';

export interface HandshakeCallbacks {
  sendAppMessage: (target: string, type: MessageType, payload: AppPayload) => void;
  onSecureChannelEstablished: (targetId: string) => void;
}

export class HandshakeManager {
  private myId: string;
  private callbacks: HandshakeCallbacks;
  private securitySessions = new Map<string, SecurityContext>();

  private keyPair = generateKeyPair();
  private myCertificate: Certificate | null = null;
  private caPublicKey: string | null = null;

  constructor(myId: string, callbacks: HandshakeCallbacks) {
    this.myId = myId;
    this.callbacks = callbacks;
  }

  public getSession(nodeId: string): SecurityContext {
    if (!this.securitySessions.has(nodeId)) {
      this.securitySessions.set(nodeId, { state: 'NONE' });
    }
    return this.securitySessions.get(nodeId)!;
  }

  public async registerWithCA() {
    return new Promise<void>((resolve, reject) => {
      const postData = JSON.stringify({ id: this.myId, publicKey: this.keyPair.publicKey });

      const req = http.request(
        {
          hostname: process.env.CA_HOST,
          port: process.env.CA_PORT,
          path: '/sign',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const response = JSON.parse(data);
              this.myCertificate = response.certificate;
              this.caPublicKey = response.caPublicKey;
              console.log(`[Crypto] Certificate Signed by CA. Ready.`);
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        },
      );

      req.on('error', (e) => {
        console.error(`[Crypto] Could not connect to CA: ${e.message}`);
        console.error(`[Crypto] Is the CA server running? (npx tsx src/ca.ts)`);
        reject(e);
      });

      req.write(postData);
      req.end();
    });
  }

  public getSecurePayload(target: string, payload: AppPayload): AppPayload {
    const session = this.securitySessions.get(target);
    if (session?.state === 'SECURE' && session.sessionKey && typeof payload === 'string') {
       console.log(`[SECURE] Encrypting data with Session Key...`);
       return {
         encrypted: true,
         ...symmetricEncrypt(payload, session.sessionKey),
       };
    }
    return payload;
  }

  public getDecryptedPayload(target: string, payload: AppPayload): AppPayload {
     if (typeof payload === 'object' && 'encrypted' in payload && payload.encrypted) {
         const session = this.securitySessions.get(target);
         if (session?.state === 'SECURE' && session.sessionKey) {
             try {
                 return symmetricDecrypt(payload, session.sessionKey);
             } catch (e) {
                 console.error('[SECURE] Decryption failed!', e);
                 return '[Decryption Failed]';
             }
         } else {
             console.warn('[SECURE] Received encrypted message but no session key available');
         }
     }
     return payload;
  }

  public initiateHandshake(target: string) {
      console.log(`[HANDSHAKE] Initiating TLS with Node ${target}...`);

      const session = this.getSession(target);
      session.state = 'HANDSHAKE_STARTED';
      session.myRandom = crypto.randomBytes(16).toString('hex');

      this.callbacks.sendAppMessage(target, MessageType.HANDSHAKE, {
        step: HandshakeStep.CLIENT_HELLO,
        random: session.myRandom,
      });
  }

  public async handleHandshakeMsg(src: string, payload: HandshakePayload) {
    const session = this.getSession(src);
    console.log(`[HANDSHAKE] Received ${payload.step} from Node ${src}`);

    switch (payload.step) {
      case HandshakeStep.CLIENT_HELLO:
        if (payload.random === undefined) {
          console.error(`[ERROR] Invalid random in CLIENT_HELLO from Node ${src}`);
          return;
        }
        session.peerRandom = payload.random;
        session.myRandom = crypto.randomBytes(16).toString('hex');

        console.log(`[HANDSHAKE] Sending Server Certificate...`);
        this.callbacks.sendAppMessage(src, MessageType.HANDSHAKE, {
          step: HandshakeStep.SERVER_HELLO,
          random: session.myRandom,
          certificate: this.myCertificate,
        });
        break;

      case HandshakeStep.SERVER_HELLO:
        if (payload.random === undefined) {
          console.error(`[ERROR] Invalid random in SERVER_HELLO from Node ${src}`);
          return;
        }
        session.peerRandom = payload.random;
        session.peerCert = payload.certificate;

        const isValid = await this.verifyWithCA(session.peerCert);
        if (!isValid) {
          console.error(`[Security] ALERT! Node ${src} has an INVALID certificate! Aborting.`);
          return;
        }
        console.log(`[Security] Node ${src} verified successfully.`);

        session.premasterSecret = crypto.randomBytes(32).toString('hex');
        const encryptedPremaster = publicEncrypt(session.premasterSecret, session.peerCert.publicKey);

        this.callbacks.sendAppMessage(src, MessageType.HANDSHAKE, {
          step: HandshakeStep.PREMASTER,
          data: encryptedPremaster,
        });

        this.deriveSessionKey(session);
        this.sendReadyMessage(src, session, HandshakeStep.READY_CLIENT);
        break;

      case HandshakeStep.PREMASTER:
        if (!this.keyPair.privateKey) return;
        try {
          session.premasterSecret = privateDecrypt(payload.data!, this.keyPair.privateKey);
          this.deriveSessionKey(session);
          console.log(`[Security] Session key derived.`);

          this.sendReadyMessage(src, session, HandshakeStep.READY_SERVER);
        } catch (e) {
          console.error('Decryption failed', e);
        }
        break;

      case HandshakeStep.READY_CLIENT:
        if (this.decryptAndVerifyReady(payload.data!, session)) {
          console.log(`\n [Secure channel established] with Node ${src}\n`);
          session.state = 'SECURE';
          this.callbacks.onSecureChannelEstablished(src);
        }
        break;

      case HandshakeStep.READY_SERVER:
        if (this.decryptAndVerifyReady(payload.data!, session)) {
          console.log(`\n [Secure channel established] with Node ${src}\n`);
          session.state = 'SECURE';
          this.callbacks.onSecureChannelEstablished(src);
        }
        break;
    }
  }

  private deriveSessionKey(session: SecurityContext) {
    const hash = crypto.createHash('sha256');
    if (!session.myRandom || !session.peerRandom || !session.premasterSecret) {
      console.error('[ERROR] Invalid session state for key derivation');
      return;
    }

    const randoms = [session.myRandom, session.peerRandom].sort();

    hash.update(session.premasterSecret);

    if (randoms[0] && randoms[1]) {
      hash.update(randoms[0]);
      hash.update(randoms[1]);
    } else {
      console.error('[ERROR] Invalid randoms for key derivation');
      return;
    }

    session.sessionKey = hash.digest('hex');
    console.log(`[Security] Derived Session Key: ${session.sessionKey.substring(0, 10)}... (based on sorted randoms)`);
  }

  private sendReadyMessage(target: string, session: SecurityContext, step: HandshakeStep.READY_CLIENT | HandshakeStep.READY_SERVER) {
    const readyText = `READY:${session.sessionKey?.substring(0, 5)}`;
    this.callbacks.sendAppMessage(target, MessageType.HANDSHAKE, {
      step: step,
      data: readyText,
    });
  }

  private decryptAndVerifyReady(data: string, session: SecurityContext): boolean {
    return data.startsWith('READY');
  }

  private async verifyWithCA(cert: any): Promise<boolean> {
    if (!this.caPublicKey) {
      console.error('[Security] Cannot verify certificate: No CA Public Key available');
      return false;
    }

    const { signature, ...certData } = cert;
    const isValid = verifySignature(certData, signature, this.caPublicKey);

    console.log(`[Security] Local verification with CA Public Key: ${isValid ? 'VALID' : 'INVALID'}`);
    return isValid;
  }
}
