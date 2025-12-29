import net from 'node:net';
import { v4 as uuidv4 } from 'uuid';
import { getNextHop } from './router.js';
import type { TransportFrame, AppMessage, TopologyData } from './types.js';
import { MessageType } from './types.js';
import topologyData from '../topology.json' with { type: 'json' };
import { MTU, BROADCAST_ID } from './constants.js';

const topology = (topologyData as TopologyData).nodes;

const reassemblyBuffer = new Map<string, { total: number; chunks: Map<number, string> }>();
const seenFragments = new Set<string>();

export interface NetworkCallbacks {
  onFrameReceived: (frame: TransportFrame) => void;
  onAppMessageReceived: (msg: AppMessage, src: string) => void;
}

export class TransportLayer {
  private myId: string;
  private myPort: number;
  private callbacks: NetworkCallbacks;

  constructor(myId: string, callbacks: NetworkCallbacks) {
    this.myId = myId;
    this.callbacks = callbacks;

    const myConfig = topology[this.myId];
    if (!myConfig) {
      throw new Error(`Critical: Node config for ${this.myId} is undefined`);
    }
    this.myPort = myConfig.port;
  }

  public startServer() {
    const server = net.createServer((socket) => {
      socket.on('data', (data) => {
        try {
          const frame: TransportFrame = JSON.parse(data.toString());
          this.handleFrame(frame);
        } catch (e) {
          console.error('Buffer error (packet overlap or corruption)');
        }
      });
    });

    server.listen(this.myPort, () => {
      console.log(`[Node ${this.myId}] Online on port ${this.myPort}`);
      const myConfig = topology[this.myId];
      if (myConfig) {
        console.log(`[Node ${this.myId}] Neighbors: ${myConfig.neighbors.join(', ')}`);
      }
    });
  }

  private handleFrame(frame: TransportFrame) {
    // 1. Broadcast Handling
    if (frame.dst === BROADCAST_ID) {
      const fragmentKey = `${frame.id}:${frame.seq}`;
      if (seenFragments.has(fragmentKey)) return;
      seenFragments.add(fragmentKey);

      if (frame.src === this.myId) return;

      this.broadcastToNeighbors(frame);
      this.processReassembly(frame, (appMsg) => {
        this.callbacks.onAppMessageReceived(appMsg, frame.src);
      });
      return;
    }


    if (frame.dst === this.myId) {
      this.callbacks.onFrameReceived(frame);
      this.processReassembly(frame, (appMsg) => {
        this.callbacks.onAppMessageReceived(appMsg, frame.src);
      });
    } else {
      console.log(`[ROUTING] Relaying frame ${frame.seq + 1}/${frame.total} for Node ${frame.dst}`);
      this.sendFrameOverWire(frame);
    }
  }

  public sendFrameOverWire(frame: TransportFrame) {
    if (frame.dst === BROADCAST_ID) {
      this.broadcastToNeighbors(frame);
      return;
    }

    const nextHop = getNextHop(this.myId, frame.dst);
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
    });
  }

  private broadcastToNeighbors(frame: TransportFrame) {
    const myConfig = topology[this.myId];
    if (!myConfig) return;
    const myNeighbors = myConfig.neighbors;
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

  private processReassembly(frame: TransportFrame, onComplete: (msg: AppMessage) => void) {
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

  public sendAppMessage(target: string, type: MessageType, payload: any) {
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
            src: this.myId,
            dst: target,
            seq: i,
            total: totalFrames,
            data: chunk,
        };
        setTimeout(() => {
            this.sendFrameOverWire(frame);
        }, i * 100);
    }
  }
}
