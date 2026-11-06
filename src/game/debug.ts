/**
 * Debug Mode (F1) 3D Visualizer ("Son Tur").
 * Draws:
 * 1. Waypoint graph nodes and connecting paths (Cyan)
 * 2. Active A* path between Player and Tour Group (Bright Green / Yellow / Red)
 * 3. Photo Zone Targets, ideal camera distance rings, and angle cones (Amber Gold)
 * 4. Police Officer's live 3D Vision Cone (Red/Orange translucent fan + wireframe)
 */

import * as THREE from 'three';
import { GAME_CONFIG } from './config';
import { PhotoZoneTarget } from './level';
import { WaypointNode } from './prng';

export class DebugVisualizer {
  public readonly debugGroup = new THREE.Group();
  public enabled = false;

  private policeVisionConeMesh: THREE.Mesh;
  private policeVisionEdges: THREE.LineSegments;
  private activePathLine: THREE.Line;
  private waypointsMap: Map<string, WaypointNode>;

  constructor(
    scene: THREE.Scene,
    waypoints: Map<string, WaypointNode>,
    photoTargets: PhotoZoneTarget[],
  ) {
    this.waypointsMap = waypoints;
    this.debugGroup.name = 'DebugF1OverlayGroup';
    this.debugGroup.visible = false;
    scene.add(this.debugGroup);

    this.buildStaticWaypointLines(waypoints);
    this.buildPhotoZoneMarkers(photoTargets);

    // Dynamic Police Vision Cone (Normal range & angle)
    const range = GAME_CONFIG.police.visionDistanceNormal;
    const halfAngle = GAME_CONFIG.police.visionConeAngleRad / 2;
    const coneShape = new THREE.BufferGeometry();
    const segments = 16;
    const vertices: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a1 = -halfAngle + (i / segments) * (halfAngle * 2);
      const a2 = -halfAngle + ((i + 1) / segments) * (halfAngle * 2);
      vertices.push(0, 0.25, 0);
      vertices.push(-Math.sin(a1) * range, 0.25, -Math.cos(a1) * range);
      vertices.push(-Math.sin(a2) * range, 0.25, -Math.cos(a2) * range);
    }
    coneShape.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    coneShape.computeVertexNormals();

    this.policeVisionConeMesh = new THREE.Mesh(
      coneShape,
      new THREE.MeshBasicMaterial({
        color: 0xff3b30,
        transparent: true,
        opacity: 0.26,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.policeVisionEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(coneShape),
      new THREE.LineBasicMaterial({ color: 0xff5e52 }),
    );
    this.debugGroup.add(this.policeVisionConeMesh, this.policeVisionEdges);

    // Dynamic A* path line from Player to Tour Group
    const pathGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.35, 0),
      new THREE.Vector3(0, 0.35, 1),
    ]);
    this.activePathLine = new THREE.Line(
      pathGeo,
      new THREE.LineBasicMaterial({ color: 0x34d399, linewidth: 2 }),
    );
    this.debugGroup.add(this.activePathLine);
  }

  private buildStaticWaypointLines(waypoints: Map<string, WaypointNode>): void {
    const edgePoints: THREE.Vector3[] = [];
    const nodeMarkerGeo = new THREE.OctahedronGeometry(0.24, 0);
    const normalMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true });
    const stopMat = new THREE.MeshBasicMaterial({ color: 0x4ade80 });

    const visitedPairs = new Set<string>();
    for (const [id, node] of waypoints.entries()) {
      const marker = new THREE.Mesh(nodeMarkerGeo, node.isTourStop ? stopMat : normalMat);
      marker.position.set(node.x, 0.25, node.z);
      this.debugGroup.add(marker);

      for (const nId of node.neighbors) {
        const pairKey = id < nId ? `${id}:${nId}` : `${nId}:${id}`;
        if (visitedPairs.has(pairKey)) continue;
        visitedPairs.add(pairKey);
        const nb = waypoints.get(nId);
        if (nb) {
          edgePoints.push(new THREE.Vector3(node.x, 0.18, node.z));
          edgePoints.push(new THREE.Vector3(nb.x, 0.18, nb.z));
        }
      }
    }

    const linesGeo = new THREE.BufferGeometry().setFromPoints(edgePoints);
    const lines = new THREE.LineSegments(
      linesGeo,
      new THREE.LineBasicMaterial({ color: 0x0284c7, transparent: true, opacity: 0.7 }),
    );
    this.debugGroup.add(lines);
  }

  private buildPhotoZoneMarkers(photoTargets: PhotoZoneTarget[]): void {
    const targetMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      wireframe: true,
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });

    for (const target of photoTargets) {
      // Sphere around photo target object
      const box = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), targetMat);
      box.position.copy(target.position);
      this.debugGroup.add(box);

      // Ideal standing zone ring on floor
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(target.minDist, target.maxDist, 20),
        ringMat,
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(target.position.x, 0.06, target.position.z);
      this.debugGroup.add(ring);

      // Direction vector line indicating ideal camera-to-target angle
      const standPoint = target.position
        .clone()
        .addScaledVector(target.idealViewDir, -(target.minDist + target.maxDist) * 0.5);
      standPoint.y = 1.2;
      const dirGeo = new THREE.BufferGeometry().setFromPoints([standPoint, target.position.clone()]);
      const dirLine = new THREE.Line(dirGeo, new THREE.LineBasicMaterial({ color: 0xfde047 }));
      this.debugGroup.add(dirLine);
    }
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.debugGroup.visible = enabled;
  }

  public update(
    policePos: THREE.Vector3,
    policeYaw: number,
    playerPos: THREE.Vector3,
    guidePos: { x: number; y: number; z: number },
    activePathIds: string[],
  ): void {
    if (!this.enabled) return;

    this.policeVisionConeMesh.position.set(policePos.x, 0.05, policePos.z);
    this.policeVisionConeMesh.rotation.y = policeYaw;
    this.policeVisionEdges.position.copy(this.policeVisionConeMesh.position);
    this.policeVisionEdges.rotation.y = policeYaw;

    // Update active A* path line between player and tour guide
    const pts: THREE.Vector3[] = [new THREE.Vector3(playerPos.x, 0.42, playerPos.z)];
    for (const id of activePathIds) {
      const wp = this.waypointsMap.get(id);
      if (wp) {
        pts.push(new THREE.Vector3(wp.x, 0.42, wp.z));
      }
    }
    pts.push(new THREE.Vector3(guidePos.x, 0.42, guidePos.z));
    this.activePathLine.geometry.dispose();
    this.activePathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }
}
