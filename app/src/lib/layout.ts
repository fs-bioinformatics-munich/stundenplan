import { overlaps } from './time';

export interface LayoutInput { key: string; day: number; start: number; end: number }
export interface Placement { lane: number; lanes: number }

/**
 * Side-by-side lane assignment per weekday.
 * Boxes that overlap (transitively) form a cluster; inside a cluster each box takes the first lane
 * whose last box has ended (greedy interval partitioning), so lanes = max simultaneous boxes.
 * Touching boxes (end == start) do not overlap.
 */
export function assignLanes(boxes: LayoutInput[]): Map<string, Placement> {
  const result = new Map<string, Placement>();
  const byDay = new Map<number, LayoutInput[]>();
  for (const b of boxes) byDay.set(b.day, [...(byDay.get(b.day) ?? []), b]);

  for (const dayBoxes of byDay.values()) {
    const sorted = [...dayBoxes].sort((a, b) => a.start - b.start || a.end - b.end || a.key.localeCompare(b.key));
    let cluster: LayoutInput[] = [];
    let clusterEnd = -1;
    const flush = () => {
      if (!cluster.length) return;
      const laneEnds: number[] = [];
      const lanes = new Map<string, number>();
      for (const b of cluster) {
        let lane = laneEnds.findIndex((end) => end <= b.start);
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(b.end); } else laneEnds[lane] = b.end;
        lanes.set(b.key, lane);
      }
      for (const b of cluster) result.set(b.key, { lane: lanes.get(b.key)!, lanes: laneEnds.length });
      cluster = [];
    };
    for (const b of sorted) {
      if (cluster.length && b.start >= clusterEnd) flush();
      cluster.push(b);
      clusterEnd = cluster.length === 1 ? b.end : Math.max(clusterEnd, b.end);
    }
    flush();
  }
  return result;
}

/** Largest number of lanes any cluster needs on each day (for column width). */
export function maxLanesPerDay(boxes: LayoutInput[], placements: Map<string, Placement>): Map<number, number> {
  const out = new Map<number, number>();
  for (const b of boxes) out.set(b.day, Math.max(out.get(b.day) ?? 1, placements.get(b.key)?.lanes ?? 1));
  return out;
}

export { overlaps };
