export type HandshakeType = 'CLIENT_HELLO' | 'SERVER_HELLO' | 'PREMASTER' | 'READY_CLIENT' | 'READY_SERVER';

export interface HandshakePayload {
  step: HandshakeType;
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

export interface AppMessage {
  type: 'HANDSHAKE' | 'DATA' | 'BROADCAST';
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
