"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { AGENTS, ORCHESTRATOR_COLOR } from "@/lib/agents";
import type { RunState, Signal } from "@/lib/run-state";

/**
 * The hive: a honeycomb board where the centre cell is the orchestrator. The
 * six cells around it are five agents and the final answer, and six more
 * agents sit on the corners of the next ring. Cells rise and
 * take colour as their agent works, and packets fly between cells for every
 * hand-off. All of it is driven by the same run state as the log.
 */

type Role =
  "orchestrator" | "answer" | "filler" | (typeof AGENTS)[number]["id"];

interface Cell {
  role: Role;
  x: number;
  z: number;
  ring: number;
  label: string;
  color: THREE.Color;
}

const SPACING = 1.08;
const INK = new THREE.Color("#12141C");
const FILLER = new THREE.Color("#DDE1EA");
const WHITE = new THREE.Color("#FFFFFF");
const FAILED = new THREE.Color("#B9BDC9");

/** Axial positions of the six cells around the centre, starting at the front. */
const RING_ONE: Array<[number, number, Role]> = [
  [0, 1, "answer"],
  [1, 0, "researcher"],
  [1, -1, "analyst"],
  [0, -1, "engineer"],
  [-1, 0, "writer"],
  [-1, 1, "critic"],
];

/** Axial positions of the six corner cells of the second ring. */
const RING_TWO: Array<[number, number, Role]> = [
  [2, 0, "strategist"],
  [2, -2, "product"],
  [0, -2, "designer"],
  [-2, 0, "factchecker"],
  [-2, 2, "risk"],
  [0, 2, "explainer"],
];

function buildCells(): Cell[] {
  const cells: Cell[] = [];
  for (let q = -3; q <= 3; q++) {
    for (let r = -3; r <= 3; r++) {
      const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      if (ring > 3) continue;
      let role: Role = "filler";
      if (ring === 0) role = "orchestrator";
      else if (ring === 1)
        role = RING_ONE.find(([a, b]) => a === q && b === r)![2];
      else if (ring === 2)
        role =
          RING_TWO.find(([a, b]) => a === q && b === r)?.[2] ?? "filler";
      const agent = AGENTS.find((a) => a.id === role);
      cells.push({
        role,
        ring,
        x: Math.sqrt(3) * SPACING * (q + r / 2),
        z: 1.5 * SPACING * r,
        label:
          role === "orchestrator"
            ? "Orchestrator"
            : role === "answer"
              ? "Answer"
              : (agent?.name ?? ""),
        color: new THREE.Color(
          role === "orchestrator"
            ? ORCHESTRATOR_COLOR
            : role === "answer"
              ? "#12141C"
              : (agent?.color ?? "#DDE1EA"),
        ),
      });
    }
  }
  return cells;
}

type Activity = "idle" | "queued" | "working" | "done" | "failed";

function activityOf(role: Role, state: RunState): Activity {
  if (role === "orchestrator")
    return state.phase === "planning"
      ? "working"
      : state.phase === "idle"
        ? "idle"
        : "done";
  if (role === "answer")
    return state.phase === "writing"
      ? "working"
      : state.phase === "done"
        ? "done"
        : "idle";
  const mine = state.tasks.filter((t) => t.agent === role);
  if (!mine.length) return "idle";
  if (mine.some((t) => t.status === "working")) return "working";
  if (mine.some((t) => t.status === "queued")) return "queued";
  if (mine.every((t) => t.status === "failed")) return "failed";
  return "done";
}

const STATUS_TEXT: Record<Activity, string> = {
  idle: "",
  queued: "",
  working: "Working",
  done: "✓",
  failed: "Failed",
};

interface Packet {
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  color: THREE.Color;
}

interface Pulse {
  at: THREE.Vector3;
  start: number;
}

const PACKET_SECONDS = 0.85;
const PULSE_SECONDS = 0.75;

const CELLS = buildCells();

interface BoardProps {
  state: RunState;
  reducedMotion: boolean;
  /** DOM labels drawn over the canvas. The board moves them every frame. */
  labels: RefObject<(HTMLElement | null)[]>;
}

function Board({ state, reducedMotion, labels }: BoardProps) {
  const cells = CELLS;
  const group = useRef<THREE.Group>(null);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const point = useMemo(() => new THREE.Vector3(), []);
  const heights = useRef<number[]>(cells.map(() => 0.05));
  const packetMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const pulseMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const packets = useRef<Packet[]>([]);
  const pulses = useRef<Pulse[]>([]);
  const lastSignal = useRef(0);
  const clock = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const { camera, size } = useThree();
  useEffect(() => {
    const ortho = camera as THREE.OrthographicCamera;
    ortho.zoom = Math.min(size.width / 12.6, size.height / 9.2);
    ortho.lookAt(0, 0.5, 0);
    ortho.updateProjectionMatrix();
  }, [camera, size]);

  // Turn new signals from the run into packets and pulses.
  useEffect(() => {
    const top = (role: Role) => {
      const index = cells.findIndex((c) => c.role === role);
      return new THREE.Vector3(
        cells[index].x,
        heights.current[index] + 0.3,
        cells[index].z,
      );
    };
    const fresh = state.signals.filter(
      (s: Signal) => s.key > lastSignal.current,
    );
    for (const signal of fresh) {
      lastSignal.current = signal.key;
      if (reducedMotion) continue;
      const now = clock.current;
      if (signal.kind === "answer") {
        for (let i = 0; i < 4; i++)
          packets.current.push({
            from: top("orchestrator"),
            to: top("answer"),
            start: now + i * 0.14,
            color: INK,
          });
      } else if (signal.agent) {
        const agent = cells.find((c) => c.role === signal.agent)!;
        if (signal.kind === "send")
          packets.current.push({
            from: top("orchestrator"),
            to: top(signal.agent),
            start: now,
            color: agent.color,
          });
        if (signal.kind === "return")
          packets.current.push({
            from: top(signal.agent),
            to: top("orchestrator"),
            start: now,
            color: agent.color,
          });
        if (signal.kind === "tool")
          pulses.current.push({ at: top(signal.agent), start: now });
      }
    }
  }, [state.signals, cells, reducedMotion]);

  const tint = useMemo(() => new THREE.Color(), []);

  useFrame((frame, dt) => {
    const step = Math.min(dt, 0.05);
    clock.current += step;
    const t = clock.current;
    const run = stateRef.current;
    const busy =
      run.phase === "planning" ||
      run.phase === "working" ||
      run.phase === "writing";
    const ease = reducedMotion ? 1 : 1 - Math.exp(-step * 7);

    cells.forEach((cell, i) => {
      const mesh = meshes.current[i];
      if (!mesh) return;
      const activity = activityOf(cell.role, run);
      let height: number;

      if (cell.role === "filler") {
        const wave = reducedMotion
          ? 0.5
          : 0.5 +
            0.5 *
              Math.sin(
                t * (busy ? 2.4 : 1.1) - cell.ring * 1.1 + cell.x * 0.25,
              );
        height = 0.16 + wave * (busy ? 0.26 : 0.12) + (3 - cell.ring) * 0.05;
        tint.copy(FILLER);
      } else {
        const bob = reducedMotion ? 0 : Math.sin(t * 6 + i) * 0.09;
        height = {
          idle: 0.55,
          queued: 0.8,
          working: 1.75 + bob,
          done: 1.1,
          failed: 0.6,
        }[activity];
        if (cell.role === "orchestrator") height += 0.35;
        const wash = {
          idle: 0.62,
          queued: 0.45,
          working: 0,
          done: 0.12,
          failed: 0,
        }[activity];
        tint
          .copy(activity === "failed" ? FAILED : cell.color)
          .lerp(WHITE, cell.role === "orchestrator" ? 0 : wash);
      }

      heights.current[i] += (height - heights.current[i]) * ease;
      const h = heights.current[i];
      mesh.scale.y = h;
      mesh.position.y = h / 2;
      (mesh.material as THREE.MeshStandardMaterial).color.lerp(tint, ease);
    });

    // Packets travel on an arc between two cells.
    packets.current = packets.current.filter(
      (p) => t - p.start < PACKET_SECONDS,
    );
    packetMeshes.current.forEach((mesh, i) => {
      if (!mesh) return;
      const packet = packets.current[i];
      const k = packet ? (t - packet.start) / PACKET_SECONDS : -1;
      mesh.visible = k >= 0;
      if (!packet || k < 0) return;
      const eased = k * k * (3 - 2 * k);
      mesh.position.lerpVectors(packet.from, packet.to, eased);
      mesh.position.y += Math.sin(Math.PI * eased) * 1.5;
      (mesh.material as THREE.MeshBasicMaterial).color.copy(packet.color);
    });

    // Tool calls ripple out from the agent's cell.
    pulses.current = pulses.current.filter((p) => t - p.start < PULSE_SECONDS);
    pulseMeshes.current.forEach((mesh, i) => {
      if (!mesh) return;
      const pulse = pulses.current[i];
      mesh.visible = Boolean(pulse);
      if (!pulse) return;
      const k = (t - pulse.start) / PULSE_SECONDS;
      mesh.position.copy(pulse.at);
      mesh.scale.setScalar(0.4 + k * 1.5);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
    });

    // The board leans a little toward the pointer.
    if (group.current && !reducedMotion) {
      group.current.rotation.y +=
        (frame.pointer.x * 0.16 - group.current.rotation.y) *
        (1 - Math.exp(-step * 3));
      group.current.updateMatrixWorld();
    }

    // Pin each DOM label to the top of its cell.
    cells.forEach((cell, i) => {
      const el = labels.current[i];
      if (!el || !group.current) return;
      point
        .set(cell.x, heights.current[i] + 0.1, cell.z)
        .applyMatrix4(group.current.matrixWorld)
        .project(frame.camera);
      const x = (point.x * 0.5 + 0.5) * frame.size.width;
      const y = (-point.y * 0.5 + 0.5) * frame.size.height;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      el.style.zIndex = String(Math.round(y));
    });
  });

  return (
    <group ref={group}>
      {cells.map((cell, i) => (
        <group key={i} position={[cell.x, 0, cell.z]}>
          <mesh
            ref={(m) => {
              meshes.current[i] = m;
            }}
            castShadow
            receiveShadow
          >
            <cylinderGeometry args={[1, 1, 1, 6]} />
            <meshStandardMaterial
              color={cell.role === "filler" ? "#DDE1EA" : "#FFFFFF"}
              roughness={0.62}
              metalness={0.02}
              flatShading
            />
          </mesh>
        </group>
      ))}

      {Array.from({ length: 14 }, (_, i) => (
        <mesh
          key={`packet-${i}`}
          visible={false}
          ref={(m) => {
            packetMeshes.current[i] = m;
          }}
        >
          <sphereGeometry args={[0.17, 16, 12]} />
          <meshBasicMaterial toneMapped={false} />
        </mesh>
      ))}
      {Array.from({ length: 8 }, (_, i) => (
        <mesh
          key={`pulse-${i}`}
          visible={false}
          rotation={[-Math.PI / 2, 0, 0]}
          ref={(m) => {
            pulseMeshes.current[i] = m;
          }}
        >
          <ringGeometry args={[0.82, 0.9, 6]} />
          <meshBasicMaterial
            color="#12141C"
            transparent
            side={THREE.DoubleSide}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function CellLabel({
  name,
  activity,
  color,
}: {
  name: string;
  activity: Activity;
  color: string;
}) {
  return (
    <span className={`cell-label cell-${activity}`}>
      <i style={{ background: color }} />
      {name}
      {STATUS_TEXT[activity] && <em>{STATUS_TEXT[activity]}</em>}
    </span>
  );
}

export default function Hive({
  state,
  reducedMotion,
}: {
  state: RunState;
  reducedMotion: boolean;
}) {
  const labels = useRef<(HTMLElement | null)[]>([]);
  return (
    <div className="hive-frame">
      <Canvas
        orthographic
        shadows
        dpr={[1, 2]}
        camera={{ position: [9, 9.5, 9], zoom: 50, near: -60, far: 120 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={1.5} />
        <directionalLight
          position={[-6, 14, 5]}
          intensity={2.1}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-12}
          shadow-camera-right={12}
          shadow-camera-top={12}
          shadow-camera-bottom={-12}
          shadow-bias={-0.0004}
        />
        <directionalLight
          position={[8, 4, -6]}
          intensity={0.5}
          color="#C9D4FF"
        />
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -0.01, 0]}
          receiveShadow
        >
          <planeGeometry args={[60, 60]} />
          <shadowMaterial opacity={0.14} />
        </mesh>
        <Board state={state} reducedMotion={reducedMotion} labels={labels} />
      </Canvas>
      <div className="cell-labels" aria-hidden>
        {CELLS.map((cell, i) =>
          cell.role === "filler" ? null : (
            <span
              key={cell.role}
              ref={(el) => {
                labels.current[i] = el;
              }}
            >
              <CellLabel
                name={cell.label}
                activity={activityOf(cell.role, state)}
                color={`#${cell.color.getHexString()}`}
              />
            </span>
          ),
        )}
      </div>
    </div>
  );
}
