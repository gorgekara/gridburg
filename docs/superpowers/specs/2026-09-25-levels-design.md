# Stacked elevation levels (Trafficity-style, phase 4)

## Goal

Draw roads at any of five levels (a tunnel at −1, ground at 0, and 1, 2, 3 above), choosing the level
of each point as you place it. A stretch between points at different levels becomes a ramp. Roads at
the same height join, even in the air, so elevated junctions and stacked interchanges can be built by
hand. Roads a level or more apart pass over or under each other.

Decisions agreed: the level is chosen per point with + and −; there are five levels, from −1 to 3.

## Today

`RSeg.structure` (0 surface, 1 bridge, 2 tunnel) gives a whole segment a fixed hump or dip, and both
of its ends are at ground. Nodes have no height. Spans are single segments that cannot be split,
joined in the middle or crossed at a junction.

## Model

- **Levels:** `RNode.level?: number`, from −1 to 3; absent means 0.
  - `levelY(level)` is the height: 1.1 per level above ground (1.1, 2.2, 3.3), and −1.8 for a tunnel.
- **Segment end heights:** `RSeg.ya` / `RSeg.yb` are derived in `resample` from the nodes' levels.
- **`roadHeight(seg, d)`:**
  - When `ya` or `yb` is non-zero: `ya + (yb − ya)·smoothstep(d / len)`. A segment with both ends at
    one level is flat at that height.
  - Otherwise: the old profile (hump, dip, or flat ground). A *legacy span* (`structure ≠ 0` with both
    ends at ground) keeps behaving exactly as today, so old saves are unchanged.
- **Structure of new roads:** derived from the levels: 1 (elevated) if either end is above ground, 2
  (tunnel) if either end is below, else 0. This keeps cost (×3 or ×4), no frontage, no parking or bike
  lanes, and trolleys staying off it.
- **Ramps:** a segment whose ends are k levels apart must be at least `4·k` long. A segment may not go
  from a tunnel to above ground.
- **Flat:** a segment is flat when `ya === yb` and it is not a legacy span. Only flat segments can be
  split, and so have junctions or ends attached in their middle. The new node takes their level.

## Joining and crossing (`network.ts`)

- `insertPath(points, kind, oneway, structure, clamp, levels?)` takes `[startLevel, endLevel]`.
  `resolveEndpoint(x, z, level)` only joins a node at that level, or a flat segment at that height.
- `layCurve` works out where the new curve crosses existing roads, and the heights of both there.
  - Within 0.25 of each other, with both flat: a junction, as today.
  - Otherwise: they pass (validation has already refused any unsafe crossing).
- Legacy spans keep their current rules: they join only at their ends and are never split.
- `splitSeg` carries the segment's structure into both halves; it refuses legacy and sloped segments.
- `moveNode` and `bendSeg` re-lay new-model segments through `layCurve`, and legacy spans as before.
- The car carry-over on edits (worker) also compares `ya` and `yb`.

## Validation (`structures.ts` `levelProblem`)

Checked for the road being drawn, and for edits:
- **Ramp length:** refused with "A ramp needs 4 cells per level".
- **Tunnel to above ground in one piece:** refused.
- **Clearance:** sampled along the new road against every other road that overlaps it on the ground.
  - A height gap of 0.25–0.9: "Too close above or below another road: leave a whole level between them".
  - Within 0.25 where either road is on a slope: "Roads can only meet where both are level".
  - The stretch within 1.2 of each shared end is exempt.
- **Water:** below 0.5 above the water surface, a road over the river is refused. The exception is a
  surface road at level 0 at both ends, which still becomes a legacy bridge automatically, as today.
- **Hills:** unchanged (roads can't climb raised ground).
- **Legacy structure plans:** `structurePlan` still applies to legacy spans.

## Drawing (`input.ts`, `snap.ts`)

- + and − (and PageUp/PageDown) change the level of the next point, −1..3, without cancelling the road
  being drawn. The tooltip shows it ("Level 2 · $…"), and so does the HUD elevation control.
- A point placed on an existing node or road takes that road's level; snapping only joins roads at
  the height being drawn. The pick plane sits at the drawing level's height, so the pointer lines up
  with the preview.
- The preview follows the height profile and is red with the reason when the road can't be built.
  Cost uses the derived structure.

## Rendering

- **`render/roads.ts`:**
  - Every non-flat-ground segment uses `heightAt`.
  - The kerb and asphalt discs at a node sit at the node's height.
  - A new tunnel segment draws its above-ground part as ordinary road, up to its mouth. The mouth is
    where the profile drops below −0.45 from an end at ground; `tunnelMouth(seg, end)`.
- **`render/structures.ts`:**
  - Decks, embankments and piers for any elevated segment are placed from its actual profile rather
    than a symmetric hump.
  - A pier is left out wherever its foot would stand on a lower road.
  - An elevated junction gets a deck platform under the node and a column.
  - Portals are placed at `tunnelMouth`.
- **Raster and traffic:** they follow `roadHeight`. Deep tunnel stretches leave the ground free. The
  1.1 spacing between levels is well over the 0.6 at which vehicle bodies are separated.

## Saving

- Node flag bits 5–7 hold the level: 0 is ground, 1–3 are levels 1–3, and 4 is level −1.
- Segment `structure` bits are unchanged. Old saves read as all ground, so nothing changes for them.

## Testing (`tests/levels.mjs`)

- **Heights:** a ramp profile; a flat elevated segment; a legacy span unchanged.
- **Joining and crossing:**
  - two level-2 roads crossing make a junction at level 2
  - a level-2 road over a ground road makes none
  - a level-1 road over a ground road makes none
  - the same pair crossing on a slope is refused
- **Validation:** a short ramp is refused; a tunnel-to-bridge piece is refused; clearance errors.
- **Edits and saves:** a split of an elevated road keeps its level; round trips through plain copies
  and binary saves.
- **Traffic:** cars drive over a stacked crossing (level-1 west–east over a ground north–south) with
  both flows arriving and nobody giving up.
- **Existing suites** stay green; old demo bridges are unchanged. Browser: build a flyover with ramps
  and an elevated junction, and take a screenshot.

## Out of scope

Roads on hills (raised ground), raising or lowering existing nodes with the Edit tool, pedestrian
stairs, and a tunnel under another tunnel.
