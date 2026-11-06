/**
 * Seeded deterministic Pseudo-Random Number Generator (Mulberry32)
 * and A* Waypoint Graph Pathfinding & Distance Calculator.
 * Same seed = identical tour route sequence, photo tasks, and police patrol route.
 */

export class SeededRNG {
  private state: number;
  public readonly seedString: string;

  constructor(seed: string) {
    this.seedString = seed.trim() || 'SOVYET-1984';
    this.state = SeededRNG.hashString(this.seedString);
  }

  public static hashString(str: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0 || 1;
  }

  /** Returns a float in [0, 1) */
  public next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns a float in [min, max) */
  public range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Returns an integer in [min, max] inclusive */
  public int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Deterministically shuffles an array copy */
  public shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }
}

export interface WaypointNode {
  id: string;
  x: number;
  y: number;
  z: number;
  roomId: string;
  neighbors: string[];
  isTourStop?: boolean;
  stopTitle?: string;
  guideSpeech?: string[];
  lookTarget?: { x: number; y: number; z: number };
}

export type DistanceZone = 'green' | 'yellow' | 'red';

/**
 * Euclidean 2D (XZ plane) + weighted Y distance between two points
 */
export function distance3D(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const dx = ax - bx;
  const dy = (ay - by) * 1.3; // Slightly weight vertical floor separation
  const dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Finds the shortest path between two waypoint IDs using A* search.
 * Returns both the ordered list of waypoint IDs and total path distance in meters.
 */
export function findShortestWaypointPath(
  nodesMap: Map<string, WaypointNode>,
  startId: string,
  goalId: string,
): { path: string[]; distance: number } {
  if (startId === goalId) {
    return { path: [startId], distance: 0 };
  }
  const startNode = nodesMap.get(startId);
  const goalNode = nodesMap.get(goalId);
  if (!startNode || !goalNode) {
    return { path: [], distance: Infinity };
  }

  const openSet = new Set<string>([startId]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();

  gScore.set(startId, 0);
  fScore.set(
    startId,
    distance3D(startNode.x, startNode.y, startNode.z, goalNode.x, goalNode.y, goalNode.z),
  );

  while (openSet.size > 0) {
    let currentId = '';
    let lowestF = Infinity;
    for (const id of openSet) {
      const f = fScore.get(id) ?? Infinity;
      if (f < lowestF) {
        lowestF = f;
        currentId = id;
      }
    }

    if (!currentId) break;
    if (currentId === goalId) {
      const path: string[] = [currentId];
      let curr = currentId;
      while (cameFrom.has(curr)) {
        curr = cameFrom.get(curr)!;
        path.unshift(curr);
      }
      return { path, distance: gScore.get(goalId) ?? 0 };
    }

    openSet.delete(currentId);
    const currentNode = nodesMap.get(currentId)!;
    const currentG = gScore.get(currentId) ?? Infinity;

    for (const neighborId of currentNode.neighbors) {
      const neighbor = nodesMap.get(neighborId);
      if (!neighbor) continue;
      const edgeCost = distance3D(
        currentNode.x,
        currentNode.y,
        currentNode.z,
        neighbor.x,
        neighbor.y,
        neighbor.z,
      );
      const tentativeG = currentG + edgeCost;
      if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
        cameFrom.set(neighborId, currentId);
        gScore.set(neighborId, tentativeG);
        const h = distance3D(
          neighbor.x,
          neighbor.y,
          neighbor.z,
          goalNode.x,
          goalNode.y,
          goalNode.z,
        );
        fScore.set(neighborId, tentativeG + h);
        openSet.add(neighborId);
      }
    }
  }

  return { path: [], distance: Infinity };
}

/**
 * Finds the nearest waypoint node ID to an arbitrary 3D position.
 */
export function findNearestWaypointId(
  nodesMap: Map<string, WaypointNode>,
  x: number,
  y: number,
  z: number,
): string {
  let bestId = '';
  let bestDist = Infinity;
  for (const [id, node] of nodesMap.entries()) {
    const d = distance3D(x, y, z, node.x, node.y, node.z);
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * Computes the true navigable path distance between the player and the tour group leader
 * by combining Euclidean distance when close and A* graph path distance through doorways/corridors.
 */
export function calculatePlayerToGroupPathDistance(
  nodesMap: Map<string, WaypointNode>,
  playerPos: { x: number; y: number; z: number },
  groupPos: { x: number; y: number; z: number },
): { distanceMeters: number; pathNodeIds: string[] } {
  const directDist = distance3D(
    playerPos.x,
    playerPos.y,
    playerPos.z,
    groupPos.x,
    groupPos.y,
    groupPos.z,
  );

  const playerWp = findNearestWaypointId(nodesMap, playerPos.x, playerPos.y, playerPos.z);
  const groupWp = findNearestWaypointId(nodesMap, groupPos.x, groupPos.y, groupPos.z);

  if (!playerWp || !groupWp || playerWp === groupWp) {
    return { distanceMeters: directDist, pathNodeIds: playerWp ? [playerWp] : [] };
  }

  const pNode = nodesMap.get(playerWp)!;
  const gNode = nodesMap.get(groupWp)!;
  const { path, distance } = findShortestWaypointPath(nodesMap, playerWp, groupWp);

  if (path.length === 0 || !Number.isFinite(distance)) {
    return { distanceMeters: directDist, pathNodeIds: [] };
  }

  const dPlayerToNode = distance3D(playerPos.x, playerPos.y, playerPos.z, pNode.x, pNode.y, pNode.z);
  const dGroupToNode = distance3D(groupPos.x, groupPos.y, groupPos.z, gNode.x, gNode.y, gNode.z);

  // Blend direct distance when in the same vicinity with graph routing across rooms
  const graphTotal = distance + dPlayerToNode * 0.65 + dGroupToNode * 0.65;
  const finalDist = Math.max(directDist, Math.min(directDist * 1.45, graphTotal));

  return { distanceMeters: finalDist, pathNodeIds: path };
}

/**
 * Classifies path distance into Green / Yellow / Red zones according to config thresholds.
 */
export function classifyGroupDistance(
  distanceMeters: number,
  greenMax: number,
  yellowMax: number,
): DistanceZone {
  if (distanceMeters <= greenMax) return 'green';
  if (distanceMeters <= yellowMax) return 'yellow';
  return 'red';
}
