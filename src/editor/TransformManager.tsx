import { useEffect, useRef } from "react";
import Konva from "konva";
import { Transformer } from "react-konva";
import { useEditorStore } from "../layers/layerStore";
import { validSelection } from "../layers/layerUtils";
import type { AABB } from "../utils/geometry";

// Konva's keepRatio only applies to corner anchors; side anchors stretch a
// single axis. While the aspect lock is on, hide side anchors so a drag can
// never break the ratio.
const ALL_ANCHORS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];
const CORNER_ANCHORS = ["top-left", "top-right", "bottom-left", "bottom-right"];

/**
 * Attaches a Konva Transformer to the current selection (visible + unlocked),
 * and writes node attrs back into the store as one undoable transaction.
 */
export function SelectionTransformer({
  nodeRefs,
  nodeRevision,
}: {
  nodeRefs: React.MutableRefObject<Record<string, Konva.Image | null>>;
  nodeRevision: number;
}) {
  const trRef = useRef<Konva.Transformer>(null);

  // joined string keeps the effect from re-running on unrelated store updates
  const attachIdsKey = useEditorStore((s) => {
    const valid = validSelection(s.layers, s.selectedIds);
    const eligible = new Set(
      s.layers.filter((l) => l.visible && !l.locked).map((l) => l.id)
    );
    return valid.filter((id) => eligible.has(id)).join(",");
  });
  const keepRatio = useEditorStore((s) => {
    const eligible = s.layers.filter((l) => s.selectedIds.includes(l.id) && l.visible && !l.locked);
    return eligible.length === 1 && eligible[0].aspectLocked === true;
  });

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const ids = attachIdsKey ? attachIdsKey.split(",") : [];
    const nodes = ids
      .map((id) => nodeRefs.current[id])
      .filter((n): n is Konva.Image => Boolean(n));
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [attachIdsKey, nodeRefs, nodeRevision]);

  return (
    <Transformer
      ref={trRef}
      rotateEnabled
      keepRatio={keepRatio}
      enabledAnchors={keepRatio ? CORNER_ANCHORS : ALL_ANCHORS}
      shiftBehavior="none"
      anchorSize={9}
      anchorCornerRadius={2}
      anchorStroke="#4f8cff"
      anchorFill="#1e1f24"
      anchorStrokeWidth={1.5}
      borderStroke="#4f8cff"
      borderStrokeWidth={1}
      rotateAnchorOffset={26}
      rotationSnaps={[0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345]}
      rotationSnapTolerance={4}
      boundBoxFunc={(oldBox, newBox) =>
        newBox.width < 2 || newBox.height < 2 ? oldBox : newBox
      }
      onTransformStart={() => {
        useEditorStore.getState().beginTransaction();
      }}
      onTransformEnd={() => {
        const store = useEditorStore.getState();
        const tr = trRef.current;
        if (!tr) return;
        for (const node of tr.nodes()) {
          const id = node.id();
          if (!id) continue;
          store.updateLayerTransform(
            id,
            {
              x: node.x(),
              y: node.y(),
              scaleX: node.scaleX(),
              scaleY: node.scaleY(),
              rotation: node.rotation(),
            },
            false
          );
        }
        store.commitTransaction();
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Alignment snapping (MVP 0.2): snap to canvas edges/center and other
// layers' edges/centers while dragging.
// ---------------------------------------------------------------------------

export interface SnapTargets {
  /** x values for vertical guide lines */
  v: number[];
  /** y values for horizontal guide lines */
  h: number[];
}

export interface SnapResult {
  dx: number;
  dy: number;
  vLine: number | null;
  hLine: number | null;
}

export function collectSnapTargets(
  canvas: { width: number; height: number },
  layerAABBs: AABB[]
): SnapTargets {
  // exclusion is resolved by the caller when building the AABB list
  const v = [0, canvas.width / 2, canvas.width];
  const h = [0, canvas.height / 2, canvas.height];
  for (const b of layerAABBs) {
    v.push(b.left, (b.left + b.right) / 2, b.right);
    h.push(b.top, (b.top + b.bottom) / 2, b.bottom);
  }
  return { v, h };
}

export function snapAABB(aabb: AABB, targets: SnapTargets, threshold: number): SnapResult {
  const candsX = [aabb.left, (aabb.left + aabb.right) / 2, aabb.right];
  const candsY = [aabb.top, (aabb.top + aabb.bottom) / 2, aabb.bottom];

  let bestX: { diff: number; line: number } | null = null;
  for (const c of candsX) {
    for (const t of targets.v) {
      const diff = t - c;
      if (Math.abs(diff) <= threshold && (!bestX || Math.abs(diff) < Math.abs(bestX.diff))) {
        bestX = { diff, line: t };
      }
    }
  }
  let bestY: { diff: number; line: number } | null = null;
  for (const c of candsY) {
    for (const t of targets.h) {
      const diff = t - c;
      if (Math.abs(diff) <= threshold && (!bestY || Math.abs(diff) < Math.abs(bestY.diff))) {
        bestY = { diff, line: t };
      }
    }
  }
  return {
    dx: bestX?.diff ?? 0,
    dy: bestY?.diff ?? 0,
    vLine: bestX?.line ?? null,
    hLine: bestY?.line ?? null,
  };
}
