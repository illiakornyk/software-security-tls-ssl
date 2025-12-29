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
  certificate?: any;
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

export interface AppMessage {
  type: MessageType;
  payload: any;
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
  peerCert?: any;
  myRandom?: string;
  peerRandom?: string;
  premasterSecret?: string;
  sessionKey?: string;
}
