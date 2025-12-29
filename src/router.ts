import topologyData from '../topology.json' with { type: 'json' };
import type { TopologyData } from './types.js';

const topology = (topologyData as TopologyData).nodes;

export function getNextHop(currentNodeId: string, targetNodeId: string): string | null {
  if (currentNodeId === targetNodeId) return null;
  if (!topology[targetNodeId]) return null;

  const queue: string[][] = [[currentNodeId]];
  const visited = new Set<string>([currentNodeId]);

  while (queue.length > 0) {
    const path = queue.shift();
    if (!path) continue;

    const node = path[path.length - 1];

    if (!node) continue;

    if (node === targetNodeId) {
      const nextHop = path[1];
      if (!nextHop) return null;
      return nextHop;
    }

    const neighbors = topology[node]?.neighbors;
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }

  return null;
}
