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
