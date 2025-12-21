export interface NodeConfig {
    port: number;
    neighbors: string[];
}

export interface TopologyData {
    nodes: Record<string, NodeConfig>;
}

export interface NetworkMessage {
    source: string;
    target: string;
    type: 'HANDSHAKE' | 'DATA' | 'BROADCAST';
    payload: any;
}
