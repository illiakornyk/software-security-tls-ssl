export enum HandshakeStep {
  CLIENT_HELLO = 'CLIENT_HELLO',
  SERVER_HELLO = 'SERVER_HELLO',
  PREMASTER = 'PREMASTER',
  READY_CLIENT = 'READY_CLIENT',
  READY_SERVER = 'READY_SERVER',
}

export interface HandshakePayload {
  step: HandshakeStep;
  random?: string;
  certificate?: Certificate;
  data?: string;
}

export interface NodeConfig {
  port: number;
  neighbors: string[];
}

export interface TopologyData {
  nodes: Record<string, NodeConfig>;
}

export enum MessageType {
  HANDSHAKE = 'HANDSHAKE',
  DATA = 'DATA',
  BROADCAST = 'BROADCAST',
}

export interface EncryptedPayload {
  encrypted: true;
  iv: string;
  content: string;
  authTag: string;
}

export type DataPayload = string | EncryptedPayload;

export type AppPayload = HandshakePayload | DataPayload;

export interface AppMessage {
  type: MessageType;
  payload: AppPayload;
}

export interface TransportFrame {
  id: string;
  src: string;
  dst: string;
  seq: number;
  total: number;
  data: string;
}

export interface Certificate {
  subject: string;
  issuer: string;
  publicKey: string;
  signature: string;
}

export interface SecurityContext {
  state: 'NONE' | 'HANDSHAKE_STARTED' | 'KEY_EXCHANGED' | 'SECURE';
  peerCert?: Certificate;
  myRandom?: string;
  peerRandom?: string;
  premasterSecret?: string;
  sessionKey?: string;
}

export enum CLICommand {
  CONNECT = 'connect',
  SEND = 'send',
  BROADCAST = 'broadcast',
}
