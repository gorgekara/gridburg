import { parkAccess } from '../parks';
import { isDecoration } from '../constants';
import { roadHeight, STRUCTURE_COST } from '../roads/structures';
import { Incidents } from './incidents';
import { T_FIRE, T_POLICE, T_POLICE_HQ, T_DOCKS, DOCK_JOBS, DOCK_CATCH } from '../constants';
import { TrafficSpace, vehicleLength, vehiclesOverlap } from './trafficSpace';
import type { VehiclePose } from './trafficSpace';
import { driverFor, idmAccel, stepMotion, curveSpeed, turnRadius, approachSpeed, segMinRadius } from './driver';
import { turnOf, criticalGap } from './priority';
import { dayProfile, purposeAt, pickByDistance } from './demand';
import { junctionKind, majorArms, stopLine, HOLD_BEHIND_LINE, SOLID_STRETCH, ZEBRA_HALF } from '../roads/control';
import { crossingApproaches } from '../roads/crossings';
import { busLaneSpan, stopKind, stopSideOf, BUS_BAY, BAY_SIDE } from '../roads/busLanes';
import { T_OFFICE, OFFICE_JOBS, OFFICE_UNLOCK, T_STATION, T_TROLLEY, T_TAXI, T_TREATMENT } from '../constants';
import { transitNetwork, transitLineForTrip, taxiStopForTrip, distance, trolleyRoute } from './transit';
import type { TransitNetwork } from './transit';
import {
  GRID, N_TILES, MAX_CARS, SIM_HZ, T_RES, T_COM, T_IND, T_PUMP, T_TOWER, T_OUTLET,
  RES_POP, COM_JOBS, IND_JOBS, POWER_DEMAND, WATER_DEMAND, IND_POLLUTION, SERVICES, START_MONEY, ROAD_UPKEEP, ROAD_UPKEEP_FACTOR,
  F_NO_POWER, F_NO_WATER, F_NO_SEWAGE, F_NO_ROAD, isZone, isService, neighbor, tileHash,
  T_FARM, T_LEISURE, FARM_JOBS, LEISURE_JOBS, LEISURE_UNLOCK, zoneBase, zoneOccupants, ZONE_NAMES,
} from '../constants';
import { defaultFunding, FUNDING_KEYS, validFunding, serviceFunding, fundingOutput, LOAN_AMOUNT, LOAN_TOTAL, LOAN_PAYMENT, NEGLECT_LIMIT } from '../management';
import { mapGates } from '../roads/entries';
import { civicShortfalls } from './growth';
import { airportClearanceMask } from '../airports';
import { isPolicyId, noPolicies, policyEffects, policyExpense, POLICIES } from '../policies';
import type { Policies, PolicyEffects } from '../policies';
import { F_DECLINING, CIVIC_LABELS } from '../constants';
import type { CivicNeed } from '../constants';
import { advanceCity } from '../progression';
import { civicCoverage } from './civic';
import { Network, SPEED, KIND_MOTORWAY, KIND_RAMP, ROAD_LABEL, isCarriageway } from '../roads/network';
import { planFor, stateIn, fixedClock, cycleOf, movements as nodeMovements, moveKey, crossingState, crossingFrom, AMBER, ALL_RED, MIN_GREEN } from '../roads/signals';
import type { SignalPlan, SignalState } from '../roads/signals';
import type { RSeg } from '../roads/network';
import { lanesFor, laneCentre, matchLanes, approachLanes, taperLength, roadHalf, sideHalf, oneWay, DEFAULT_LANES, MAXL } from '../roads/lanes';
import { isOneWayKind } from '../roads/network';
import { generateTerrain, touchesWater, adjacentFlow } from '../terrain';
import type { Terrain } from '../terrain';
import type { EditPayload, MainToWorker, Stats, TileReport } from './messages';
import { CAR_BRAKE, CAR_LEFT, CAR_RIGHT, CAR_BLUE, CAR_LEAVING } from './messages';
import { T_RECYCLING, T_BUS, T_SUBWAY } from '../constants';
import { defaultExtras, shapeTerrain, districtHas, DISTRICT_POLICIES, DISTRICT_POLICY_IDS, DISTRICT_COUNT } from '../extras';
import { WaterSim, WATER_HZ } from './water';
import type { CityExtras } from '../extras';
import { noiseMap, landValueMap, wellbeingMap, goodsFlow, tourism as tourismFlow, accumulateGarbage, waterDistance, GARBAGE_PICKUP_RADIUS } from './economy';
import type { GoodsReport, TourismReport } from './economy';
import { Disasters } from './disasters';

const post = (self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void }).postMessage.bind(self);

// ---- city state --------------------------------------------------------------------------
const kind = new Uint8Array(N_TILES);
let airportClearance: Uint8Array = new Uint8Array(N_TILES);
const level = new Uint8Array(N_TILES);
const age = new Uint16Array(N_TILES);
const neglect = new Uint8Array(N_TILES);
const flags = new Uint8Array(N_TILES);
let cover: Uint8Array = new Uint8Array(N_TILES);
let accSeg = new Int32Array(N_TILES).fill(-1); // segment *index* after remapping, -1 if none
let accS: Float32Array = new Float32Array(N_TILES);
let pollution = new Float32Array(N_TILES);
let pollutionTmp = new Float32Array(N_TILES);
let terrain: Terrain = generateTerrain(1);
let riverPollution = new Float32Array(terrain.river.length);

let funding = defaultFunding();
let debt = 0;
let taxIncome = 0, serviceExpense = 0, loanExpense = 0;
let inspected = -1;
let cityLevel = 0;
let happiness = 65;
let civicState = civicCoverage(kind, level, () => false);
let money = START_MONEY;
let tick = 0;
let tax = 10;
let speed = 1;
let streetView = false;
/** How much of the usual traffic is on the road: less while the player drives, so the streets are drivable. */
let trafficScale = 1;
/** A race is on: the streets are cleared of everything but emergencies answering a call. */
let racing = false;
/** Where the player's own car (or the player on foot) stands, in map coordinates, if on a road. */
let player: { x: number; z: number } | null = null;
/** Lane key → how far along that lane the player stands, for the traffic behind to stop for. */
const playerLanes = new Map<number, number>();

/** Find the lanes the player blocks: the side of each road they stand on, or both near the middle. */
function locatePlayer(): void {
  playerLanes.clear();
  if (!player) return;
  const { x, z } = player;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const reach = roadHalf(seg) + 0.05;
    if (x < seg.minX - reach || x > seg.maxX + reach || z < seg.minZ - reach || z > seg.maxZ + reach) continue;
    const hit = Network.nearestOn(seg, x, z);
    if (hit.dist > reach) continue;
    const pose = { x: 0, z: 0, tx: 0, tz: 1 };
    Network.poseAt(seg, hit.s, pose);
    // Which side of the centre line: right of a → b is where the forward lane runs.
    const side = (x - pose.x) * -pose.tz + (z - pose.z) * pose.tx;
    if (side > -0.1 || seg.oneway) playerLanes.set(i * 2, hit.s);
    if (side < 0.1 && !seg.oneway) playerLanes.set(i * 2 + 1, seg.len - hit.s);
  }
}
let simTime = 0;
let pop = 0, comJobs = 0, indJobs = 0, officeJobs = 0, buildings = 0;
let commuteAvg = 0;
let noPath = 0, gaveUp = 0;
/** Running totals for the traffic probe tests use; never reset by the economy tick. */
let arrivedTotal = 0, gaveUpTotal = 0;
/** Completed trips by first and last road (segment ids), for the probe. */
const arrivedBy = new Map<string, number>();
let subCount = 0;
let netIncome = 0;
const demand: [number, number, number, number] = [0, 0, 0, 0];
let trolleyNet = new Network();
let trolleySegIndex = new Map<number, number>();
let transit: TransitNetwork = { lines: [], airports: [], intercity: [] };
let transitSignature = '';
let taxiStops: number[] = [];
let taxiWindow = 0;
let transitTokens: number[] = [], transitDepartures: number[] = [];
let riders = 0, airPassengers = 0, railPassengers = 0, fareIncome = 0, treatedSewage = 0;
/** Street racing: a few cars tearing across town after dark, and the clock until they disperse. */
let raceUntil = -1;
let robbedSeen = 0;
let policies: Policies = noPolicies();
let effects: PolicyEffects = policyEffects(policies);
let policyCost = 0;
let tollIncome = 0, tollWindow = 0;
let fishingIncome = 0, docks = 0;
let riderWindow = 0, airWindow = 0, airTokens = 0;
let railWindow = 0, railTokens = 0;
let power: [number, number] = [0, 0];
let water: [number, number] = [0, 0];
let sewage: [number, number] = [0, 0];
let dirtyShare = 0;
let resPollution = 0;
let unservedRes = 0;
let pendingMoveIns: number[] = [];
// ---- economy, districts and disasters -----------------------------------------------------------
let extras: CityExtras = defaultExtras();
let baseTerrain: Terrain = terrain;
let riverDistance = waterDistance(terrain.water);
/** The river and whatever it spills, as water on the ground. */
let river = new WaterSim(terrain);
/** Seconds before the city is warned about floodwater again. */
let floodWarning = 0;
let landValue: Float32Array = new Float32Array(N_TILES).fill(40);
let noise: Float32Array = new Float32Array(N_TILES);
let wellbeing: Float32Array = new Float32Array(N_TILES);
const garbage = new Float32Array(N_TILES);
let transitReach: Float32Array = new Float32Array(N_TILES);
let goods: GoodsReport = goodsFlow(kind, level, 0, { entries: 0, railLines: 0, docks: 0, airports: 0 });
let visitors: TourismReport = { attraction: 0, access: 0, visitors: 0, income: 0 };
let districtCost = 0;
let freightBudget = 0;
let throughBudget = 0;
/** Cars a second passing along the highway from one gate to another without stopping in town. */
const THROUGH_RATE = 0.35;
/** Traffic just passing through: in at one gate, out at another, never leaving the highway. */
function throughTrip(): void {
  // A one-way approach only carries traffic one way: in at its start, out at its end.
  const ins = entries.filter(e => !segs[e.seg].oneway || e.s === 0), outs = entries.filter(e => !segs[e.seg].oneway || e.s > 0);
  if (!ins.length || !outs.length) return;
  const from = ins[Math.floor(Math.random() * ins.length)];
  const exits = outs.filter(e => e.seg !== from.seg && Math.hypot(segs[e.seg].pts[0] - segs[from.seg].pts[0], segs[e.seg].pts[1] - segs[from.seg].pts[1]) > 20);
  const to = exits[Math.floor(Math.random() * exits.length)];
  if (!to) return;
  const vehicle = Math.random() < 0.2 ? 3 : Math.random() < 0.3 ? 2 : 1;
  const slotBefore = freeList.at(-1);
  if (spawnTrip(from.seg, from.s, to.seg, to.s, vehicle) && slotBefore !== undefined && slots[slotBefore]) slots[slotBefore]!.through = true;
}
let disasterRate = 1;
const disasters = new Disasters();
/** Tax rate in percent for a zoned tile: its zone's rate, less a district tax break. */
function taxAt(i: number): number {
  const rate = extras.taxes[zoneBase(kind[i]) - T_RES] ?? 10;
  const d = extras.district[i];
  return d && districtHas(extras.districtPolicies[d - 1], 'taxBreak') ? Math.max(0, rate - 4) : rate;
}
const districtPolicy = (i: number, id: typeof DISTRICT_POLICY_IDS[number]): boolean => {
  const d = extras.district[i];
  return !!d && districtHas(extras.districtPolicies[d - 1], id);
};
/** Road component a tile draws its utilities through: power lines and pipes run along the streets. */
const utilityComponent = (i: number): number => accSeg[i] >= 0 ? component[segA[accSeg[i]]] : -1;
function setTerrain(): void {
  terrain = shapeTerrain(baseTerrain, extras.terraform);
  riverDistance = waterDistance(terrain.water);
  river.reshape(extras.terraform, kind);
}

// ---- road graph snapshot --------------------------------------------------------------------
const J_PLAIN = 0, J_YIELD = 1, J_LIGHT = 2, J_RING = 3, J_STOP = 4;
/** How long a driver must actually stand at a stop line before pulling away. */
const STOP_WAIT = 0.55;
interface Edge { seg: number; to: number; fwd: boolean }
let serial = 0;
let segs: RSeg[] = [];
let segA: number[] = []; // node indices
let segB: number[] = [];
let nodeX: number[] = [];
let nodeZ: number[] = [];
let nodeIds: number[] = [];
let nodeType: number[] = [];
let nodeEdges: Edge[][] = [];
/**
 * Per signalised node: the plan it runs, its phase clock (phase, seconds into it, and how long this
 * phase's green lasts, which an adaptive signal stretches or cuts), and the approaches (as segment
 * index and direction) whose queues tell it where traffic is waiting.
 */
let sigPlan: (SignalPlan | null)[] = [];
let sigPhase = new Int16Array(0), sigT = new Float32Array(0), sigLen = new Float32Array(0);
let sigApproaches: { seg: number; fwd: boolean }[][] = [];
let sigCheck = 0;
/** Tests only: box admissions at signals, by the state the car's movement was in. */
const sigAdmits: Record<string, number> = {};
let lockOwner = new Int32Array(0); // per node and half (node·2 + 0 outer, + 1 inner): the slot holding it, or -1
let ringClaim = new Int32Array(0); // per roundabout node: the slot of an entering car whose turn is next
let ringRoomless = new Float32Array(0); // per roundabout node: when its booker was last held for want of room on the ring
let ringArc = new Uint8Array(0); // one-way segment between two roundabout nodes
/** Per slip road: which side of the carriageway it leaves from / joins on (±1, 0 for none) and how long the merge runs. */
let rampStart = new Int8Array(0), rampEnd = new Int8Array(0), rampMouth = new Float32Array(0), rampLane = new Float32Array(0);
let ringIn: number[][] = []; // per node: lane keys of the ring arcs that feed it
/** Per ring arc: the length of its ring all the way round. */
let ringLength = new Float32Array(0);
let nodeHalf = new Float32Array(0); // half width of the widest road meeting the node
let reach = new Uint8Array(0);
let component = new Int32Array(0);
let entryNodes: number[] = [];
/** Where roads from outside come onto the map, for the transit and trade that use them. */
let gates: { x: number; z: number; dx: number; dz: number }[] = [];
let entries: { seg: number; s: number }[] = [];
let segCong = new Float32Array(0);
/** The network itself, for lane layouts and turn tables. */
let laneNet = new Network();
/** Per direction of a segment (seg·2 + dir): its lanes; per lane (dirKey·MAXL + lane): centre offset, and the stretch where it is full width. */
let dirLanes = new Uint8Array(0);
let laneCentreTab = new Float32Array(0), laneFromTab = new Float32Array(0), laneToTab = new Float32Array(0);
/** Turn tables for each approach (seg·2 + dir), built when first needed. */
let approachCache = new Map<number, { exits: { seg: number; fwd: boolean; angle: number; lanes: number }[]; serve: number[][]; targets(lane: number, exit: number): number[] }>();
/** Cars inside each junction box, the car that has waited longest and reserved it, and cached movement paths and conflicts. */
let boxCars: number[][] = [];
let boxWait = new Int32Array(0);
let movePaths = new Map<string, VehiclePose[]>();
/** Per segment: the speed its tightest curve allows. Per movement through a node: the speed its turn allows. */
let segCurveV = new Float32Array(0);
let turnV = new Map<number, number>();
/** Which way each movement turns: 0 straight, 1 right, 2 left. */
let turnK = new Map<number, number>();
/**
 * Priority at uncontrolled junctions: per node, whether one road through it is the major one; per
 * approach (seg·2 + dir, arriving at its end node), whether it is on that road. And every node's
 * approaches.
 */
let nodePriority = new Uint8Array(0);
let majorIn = new Uint8Array(0);
let nodeIn: { seg: number; fwd: boolean }[][] = [];
/**
 * Per node: a callout is about to reach it, or is in it, so nobody else is let in; the approach it is
 * coming along (seg·2 + dir) is −1 for none, and traffic ahead of it on that same approach goes on.
 */
let blueAt = new Uint8Array(0), blueFrom = new Int32Array(0);
/**
 * Zebra crossings, where people cross and traffic gives way to them. Each lies across one end of a
 * segment: its centre, the direction across (to the right of a→b), the sideways extent of the road
 * (lo to hi in that direction), the people waiting at each kerb and those walking across.
 */
interface Walker { u: number; dir: 1 | -1; v: number; id: number }
interface Crossing {
  node: number; seg: number; end: 0 | 1; dist: number;
  cx: number; cz: number; ux: number; uz: number; lo: number; hi: number;
  waiting: [number, number]; lastStep: [number, number]; rate: number; walkers: Walker[];
  /** At a signal: the movements whose green stops people crossing, worked out once per plan. */
  from?: string[]; fromPlan?: SignalPlan;
}
/** A car kept waiting this long at a zebra gets its turn: people let it go before stepping out. */
const WALK_COURTESY = 4;
let walkerStart = 0;
let crossings: Crossing[] = [];
/** Per segment end (seg·2 + end, 0 at a): the crossing there, or −1. */
let crossingAt = new Int32Array(0);
let walkerSeq = 0, walkersOut = 0;
/** Tests only: every crossing's arrival rate, instead of the buildings'; −1 for none. */
let walkRateOverride = -1;
/** People walk about 1.3 m/s: 0.3 cells a game second. At most this many out at once, and waiting per kerb. */
const WALK_SPEED = 0.3, MAX_WALKERS = 320, MAX_WAITING = 6;

/** Per approach (seg·2 + dir): how far before its end node traffic holds. */
let approachSetback = new Float32Array(0);
/** Per segment and direction: where its bus lane's rule applies, along the direction of travel (−1 for none). */
let busFrom = new Float32Array(0), busTo = new Float32Array(0);
/** Bus stops buses call at on the way: segment index, arc length from its a end, which side (+1 right of a→b), and whether from a lay-by. */
interface BusStop { seg: number; s: number; side: number; bay: boolean }
let busStops: BusStop[] = [];
let probeStops: BusStop[] = [];
/** The tiles of the stops on bus lines, and the probe's own stops as asked for (by segment id). */
let busStopTiles: number[] = [];
let probeStopIds: { a: number; as: number; side: number }[] = [];

/** Where buses call, worked out again whenever the stops or the roads change. */
function refreshBusStops(): void {
  const net = laneNet;
  const zebras = crossingApproaches(net);
  const make = (seg: number, s: number, side: number): BusStop[] => {
    const sg = segs[seg];
    const how = sg ? stopKind(net, sg, s, side, zebras) : null;
    return how ? [{ seg, s, side, bay: how === 'bay' }] : [];
  };
  busStops = busStopTiles.flatMap(t => (accSeg[t] >= 0 && segs[accSeg[t]] ? make(accSeg[t], accS[t], stopSideOf(segs[accSeg[t]], accS[t], t % GRID + 0.5, Math.floor(t / GRID) + 0.5)) : []));
  const index = new Map(segs.map((sg, i) => [sg.id, i]));
  probeStops = probeStopIds.flatMap(st => { const i = index.get(st.a); return i === undefined ? [] : make(i, st.as, st.side); });
}
/**
 * Traffic counts per direction of each segment (seg·2 + dir): vehicles leaving it this second, the
 * smoothed flow in vehicles a minute, and the smoothed delay per vehicle (time spent standing on it).
 */
let flowCount = new Uint16Array(0), flowRate = new Float32Array(0), delayAvg = new Float32Array(0);
/** The road being inspected, by segment id, and the tile it was clicked on; −1 for none. */
let inspectedSeg = -1;
let moveConflicts = new Map<string, boolean>();
let roadUpkeep = 0;
let roadLength = 0;

// ---- cars ---------------------------------------------------------------------------------------
/** A stretch of one segment on a route. On a motorway, which side the slip road ahead or behind is on (±1), if any. */
interface Leg { seg: number; fwd: boolean; p0: number; p1: number; toRamp?: number; fromRamp?: number;
  /** The far stop of a bus run on this leg, where it stands (only while its route is put together). */
  dwell?: number }
/** A stop a bus calls at: its centre stands at `p` on leg `li`; a bay takes it out of the lane. */
interface Call { li: number; p: number; far: boolean; bay: boolean }
interface Mission { kind: 'fire' | 'patrol' | 'crash' | 'heist' | 'garbage'; origin: number; tile: number; crash?: number; work: number }
interface Car {
  uid: number; legs: Leg[]; li: number; p: number; time: number;
  /** Speed along the leg, cells/s. */
  v: number;
  /** Time spent below walking pace on the current leg: its delay there. */
  stood: number;
  /** Its last acceleration, and when it last braked or stood (for its brake lights). */
  accel: number; brakeT: number;
  /** A sideways shift off its lane's centre (pulling over, or passing a car that has), and where it is easing to. */
  side: number; sideGoal: number;
  /** Making way for a callout behind it: until when, and for which one. */
  yieldUntil: number; yieldTo: number;
  /** Stuck past its patience: it no longer waits on bookings, gaps or give-way, only on bodies in the way. */
  insistent: boolean;
  /** A bus's stops, in order, and the next one it has to make; until when it stands at it. */
  calls?: Call[]; callIdx?: number; dwellUntil?: number;
  /** Standing in a lay-by, out of its lane: following traffic passes it. Pulling back out of one. */
  inBay?: boolean; leavingBay?: boolean;
  /** A trip out and back (a probe's bus run), which keeps its route; and when it last rerouted. */
  loop?: boolean; rerouteAt?: number;
  /** A callout's view of the road ahead: an oncoming car close enough that it must not pull out. */
  oncoming?: boolean;
  /** A callout with cars pulled over ahead of it, waiting for room to pass them. */
  wantPass?: boolean; pace: number; stuck: number; stopAt?: number; lock: number; lockLi: number; lockStop: number; lockMask: number; vehicle: number; taxiStop?: number; line?: number; mission?: Mission; crash?: number; working?: boolean; through?: boolean;
  /** The lane on the current leg (0 = kerb), the one it will take on the next leg (−1 until chosen), and the one it came from. */
  lane: number; nextLane: number; prevLane: number;
  /** A lane change in progress: the sideways offset it started from, where and when; chT < 0 when not changing. */
  chFrom: number; chP: number; chT: number; chLane: number;
  /** No lane change before this time. */
  lcCool: number;
  /** How long it has waited at a stop line in a lane that does not go its way. */
  laneWait: number;
  /** The junction box it is inside (−1 for none), and the leg it entered it from. */
  box: number; boxLi: number;
  /** When it was last held at a stop line by nothing but traffic crossing the box. */
  boxBlockedAt: number;
}
const trafficSpace = new TrafficSpace();
const spawnSpace = new TrafficSpace();
let carSequence = 0;
const incidents = new Incidents();
const dispatchCooldown = new Map<number, number>();
const slots: (Car | null)[] = new Array(MAX_CARS).fill(null);
/** Vehicle slots only service vehicles and public transport may take. */
const SERVICE_RESERVE = 24;
const freeList: number[] = [];
for (let i = MAX_CARS - 1; i >= 0; i--) freeList.push(i);
let activeCars = 0;
let laneCars: number[][] = [];
let laneTail = new Float32Array(0);
let laneFresh = new Float32Array(0); // lowest p of a car that crossed into the lane during this step
let laneTailV = new Float32Array(0); // speed of the rearmost car in each lane
/** Per lane: the last car to leave it, still crossing the junction beyond, whatever way it went. */
let laneLeft = new Int32Array(0);
/** Per lane: cars part-way through a change out of it, still partly in it. */
const laneGhosts = new Map<number, number[]>();
let spawnBudget = 0;
let extBudget = 0;
let tripRate = 0;
let extRate = 0;

let resTiles: number[] = [], resW: number[] = [];
let jobTiles: number[] = [], jobW: number[] = [];

const GAP = [0.42, 0.42, 0.4, 0.46, 0.5, 0.4, 0.48];
const STOP_SETBACK = 0.85; // how far before a junction a car holds, for a plain one-tile road
const RING_PATIENCE = 6; // seconds an entering car gives way before it books its turn on the ring
const MINOR_PATIENCE = 12; // seconds a car off the major road waits for a gap before it forces its way in
/**
 * Under blue lights: a fire engine to a fire, a patrol to a crash or a robbery, on its way. A routine
 * patrol or a bin lorry drives like everyone else.
 */
function onCallout(c: Car | null | undefined): boolean {
  return !!c && !!c.mission && !c.working && (c.mission.kind === 'fire' || c.mission.kind === 'crash' || c.mission.kind === 'heist');
}
/** A callout this many seconds from a junction holds everyone else back from it. */
const BLUE_WARNING = 3;
/** Cars this far ahead of a callout in its lane make way for it. */
const MAKE_WAY = 4;
/** How far a car pulls over towards the kerb, and how far a callout eases out to pass it. */
const PULL_OVER = 0.15, PASS_OUT = 0.14;
/** A callout only pulls out to pass while no oncoming car is within this far ahead. */
const ONCOMING_CLEAR = 3;
/** Past this share of its patience a stuck car no longer waits on bookings, gaps or give-way. */
const INSIST_SHARE = 2 / 3;
/** A circulating car this soon from a ring node is too close to pull out in front of. */
const RING_TC = 1.3;
const RING_GAP = 1.3; // distance before a roundabout node inside which circulating cars have right of way


function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function pickWeighted(tiles: number[], cum: number[]): number {
  const r = Math.random() * cum[cum.length - 1];
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] > r) hi = mid; else lo = mid + 1;
  }
  return tiles[lo];
}

// ---- network snapshot -----------------------------------------------------------------------
function applyNetwork(p: EditPayload): void {
  const net = Network.fromPlain(p.net);
  trolleyNet = net;
  laneNet = net;
  const oldLens = segs.map((s) => s.len);
  const oldNodeIds = nodeIds;
  const oldA = segs.map((s) => s.a);
  const oldYa = segs.map((s) => s.ya), oldYb = segs.map((s) => s.yb);

  serial = p.serial;
  const nodeIndex = new Map<number, number>();
  nodeX = []; nodeZ = []; nodeIds = []; nodeType = []; nodeEdges = [];
  entryNodes = [];
  for (const n of net.nodes.values()) {
    nodeIndex.set(n.id, nodeIds.length);
    nodeIds.push(n.id);
    nodeX.push(n.x);
    nodeZ.push(n.z);
    nodeEdges.push([]);
    // What controls the junction, by the rules the renderer paints it with (roads/control.ts).
    const kind = junctionKind(net, n.id);
    nodeType.push(kind === 'ring' ? J_RING : kind === 'light' ? J_LIGHT : kind === 'stop' ? J_STOP : kind === 'yield' ? J_YIELD : J_PLAIN);
    if (n.entry) entryNodes.push(nodeIds.length - 1);
  }
  gates = mapGates(net);
  // Keep surviving segments at stable indices where possible is not needed: cars are remapped by id below.
  const newSegs: RSeg[] = [];
  const segIndex = new Map<number, number>();
  for (const pl of p.net.segs) {
    const s = net.segs.get(pl[0]);
    if (!s) continue;
    segIndex.set(s.id, newSegs.length);
    newSegs.push(s);
  }
  trolleySegIndex = segIndex;
  segA = newSegs.map((s) => nodeIndex.get(s.a)!);
  segB = newSegs.map((s) => nodeIndex.get(s.b)!);
  roadUpkeep = 0;
  roadLength = 0;
  newSegs.forEach((s, i) => {
    nodeEdges[segA[i]].push({ seg: i, to: segB[i], fwd: true });
    if (!s.oneway) nodeEdges[segB[i]].push({ seg: i, to: segA[i], fwd: false });
    // The motorway and its interchanges came with the map: the city neither pays for nor counts them.
    // A road with lanes added costs more to keep, in proportion to the lanes it carries.
    const lanes = lanesFor(net, s, true) + lanesFor(net, s, false), usual = oneWay(s) ? (isOneWayKind(s.kind) ? DEFAULT_LANES[s.kind] : 2 * DEFAULT_LANES[s.kind]) : 2 * DEFAULT_LANES[s.kind];
    if (!s.fixed) { roadUpkeep += s.len * ROAD_UPKEEP * STRUCTURE_COST[s.structure ?? 0] * (ROAD_UPKEEP_FACTOR[s.kind] ?? 1) * Math.max(0.5, lanes / Math.max(1, usual)); roadLength += s.len; }
  });
  lockOwner = new Int32Array(nodeIds.length * 2).fill(-1);
  ringClaim = new Int32Array(nodeIds.length).fill(-1);
  ringRoomless = new Float32Array(nodeIds.length).fill(-1e9);
  ringArc = new Uint8Array(newSegs.length);
  ringIn = nodeIds.map(() => []);
  newSegs.forEach((s, i) => {
    if (!s.oneway || nodeType[segA[i]] !== J_RING || nodeType[segB[i]] !== J_RING) return;
    ringArc[i] = 1;
    for (let l = 0; l < lanesFor(net, s, true); l++) ringIn[segB[i]].push(i * 2 * MAXL + l);
  });
  // Each ring's length all the way round, for choosing a lane on the way in.
  ringLength = new Float32Array(newSegs.length);
  newSegs.forEach((_, i) => {
    if (!ringArc[i] || ringLength[i]) return;
    const loop: number[] = [];
    let cur = i;
    for (let k = 0; k < 64; k++) {
      loop.push(cur);
      const nx = nodeEdges[segB[cur]].find(e => ringArc[e.seg] && e.fwd);
      if (!nx || nx.seg === i) break;
      cur = nx.seg;
    }
    const total = loop.reduce((t, k) => t + newSegs[k].len, 0);
    for (const k of loop) ringLength[k] = total;
  });
  // Slip roads: note which carriageway they leave or join, on which side, and how far they run
  // alongside it, so cars drift out of the outer lane instead of cutting across from the centre.
  rampStart = new Int8Array(newSegs.length); rampEnd = new Int8Array(newSegs.length); rampMouth = new Float32Array(newSegs.length); rampLane = new Float32Array(newSegs.length);
  const pose = { x: 0, z: 0, tx: 0, tz: 0 };
  newSegs.forEach((s, i) => {
    if (s.kind !== KIND_RAMP) return;
    for (const end of [0, 1]) {
      const node = end ? segB[i] : segA[i];
      const road = newSegs.find((o, j) => j !== i && isCarriageway(o.kind) && (segA[j] === node || segB[j] === node));
      if (!road) continue;
      // Travel direction of the carriageway at the node, and the ramp a little way from it.
      const j = newSegs.indexOf(road);
      Network.poseAt(road, segA[j] === node ? 0.3 : road.len - 0.3, pose);
      const tx = pose.tx, tz = pose.tz;
      Network.poseAt(s, end ? Math.max(0, s.len - 1.5) : Math.min(s.len, 1.5), pose);
      const ox = pose.x - nodeX[node], oz = pose.z - nodeZ[node];
      const side = (-tz * ox + tx * oz) > 0 ? 1 : -1;
      let mouth = 0.5;
      for (let d = 0.5; d < Math.min(s.len - 0.5, 9); d += 0.25) {
        Network.poseAt(s, end ? s.len - d : d, pose);
        mouth = d;
        if (Network.nearestOn(road, pose.x, pose.z).dist > roadHalf(road) + 0.25) break;
      }
      if (end) rampEnd[i] = side; else rampStart[i] = side;
      rampMouth[i] = Math.max(rampMouth[i], mouth);
      // The ramp meets the carriageway's lane on its own side, wherever lanes have put that lane.
      // Carriageways are one way, so their lanes all run a→b.
      const roadFwd = true;
      const n = lanesFor(net, road, roadFwd);
      rampLane[i] = Math.abs(laneCentre(net, road, roadFwd, side > 0 ? 0 : Math.max(0, n - 1))) || (road.kind === KIND_MOTORWAY ? 0.44 : 0.25);
    }
  });
  nodeHalf = new Float32Array(nodeIds.length);
  nodeIds.forEach((id, ni) => {
    for (const s of net.segsAt(id)) nodeHalf[ni] = Math.max(nodeHalf[ni], roadHalf(s));
  });

  // Any purchased highway entry can serve its own connected neighborhoods.
  reach = new Uint8Array(nodeIds.length);
  entries = [];
  const und: number[][] = nodeIds.map(() => []);
  newSegs.forEach((_, i) => { und[segA[i]].push(segB[i]); und[segB[i]].push(segA[i]); });
  component = new Int32Array(nodeIds.length).fill(-1);
  for (let root = 0; root < nodeIds.length; root++) {
    if (component[root] >= 0) continue;
    const pending = [root]; component[root] = root;
    while (pending.length) {
      const node = pending.pop()!;
      for (const next of und[node]) if (component[next] < 0) { component[next] = root; pending.push(next); }
    }
  }
  const stack = [...entryNodes];
  for (const n of entryNodes) reach[n] = 1;
  while (stack.length) {
    const n = stack.pop()!;
    for (const m of und[n]) if (!reach[m]) { reach[m] = 1; stack.push(m); }
  }
  for (const n of entryNodes) newSegs.forEach((s, i) => {
    if (segA[i] === n) entries.push({ seg: i, s: 0 });
    else if (segB[i] === n) entries.push({ seg: i, s: s.len });
  });
  transitSignature = '';

  // Carry congestion over for surviving segments; drop cars whose route touched a changed segment.
  const newCong = new Float32Array(newSegs.length);
  const remap = new Int32Array(segs.length).fill(-1);
  segs.forEach((s, i) => {
    const ni = segIndex.get(s.id);
    if (ni === undefined) return;
    const ns = newSegs[ni];
    if (Math.abs(ns.len - oldLens[i]) > 1e-3 || ns.a !== oldA[i] || ns.kind !== s.kind || ns.oneway !== s.oneway || ns.structure !== s.structure || ns.cx !== s.cx || ns.cz !== s.cz || (ns.addR ?? 0) !== (s.addR ?? 0) || (ns.addL ?? 0) !== (s.addL ?? 0) || (ns.ya ?? 0) !== (oldYa[i] ?? 0) || (ns.yb ?? 0) !== (oldYb[i] ?? 0)) return;
    remap[i] = ni;
    newCong[ni] = segCong[i];
  });
  for (let c = 0; c < MAX_CARS; c++) {
    const car = slots[c];
    if (!car) continue;
    let ok = true;
    for (const leg of car.legs) {
      const ni = remap[leg.seg];
      if (ni < 0) { ok = false; break; }
    }
    if (!ok) { freeCar(c); continue; }
    for (const leg of car.legs) leg.seg = remap[leg.seg];
    car.lock = -1; // locks were reset with the node arrays
    car.box = -1; car.nextLane = -1;
  }
  segs = newSegs;
  segCong = newCong;
  segCurveV = Float32Array.from(segs, s => curveSpeed(segMinRadius(s)));
  flowCount = new Uint16Array(segs.length * 2); flowRate = new Float32Array(segs.length * 2); delayAvg = new Float32Array(segs.length * 2);
  turnV = new Map(); turnK = new Map();
  // Priority: at each uncontrolled junction, the road that runs straight through and outranks the rest.
  nodePriority = new Uint8Array(nodeIds.length);
  majorIn = new Uint8Array(segs.length * 2);
  nodeIn = nodeIds.map(() => []);
  segs.forEach((sg, i) => {
    if (segA[i] === segB[i]) return;
    nodeIn[segB[i]].push({ seg: i, fwd: true });
    if (!sg.oneway) nodeIn[segA[i]].push({ seg: i, fwd: false });
  });
  const segIdx = new Map(segs.map((sg, i) => [sg.id, i]));
  for (let ni = 0; ni < nodeIds.length; ni++) {
    const major = nodeType[ni] === J_YIELD ? majorArms(net, nodeIds[ni]) : null;
    if (!major) continue;
    nodePriority[ni] = 1;
    for (const id of major) { const i = segIdx.get(id)!; majorIn[i * 2 + (segB[i] === ni ? 0 : 1)] = 1; }
  }
  // Where each approach holds its traffic: just behind the stop line the renderer paints, which sits
  // short of the zebra crossing, so no car stands on it.
  blueAt = new Uint8Array(nodeIds.length); blueFrom = new Int32Array(nodeIds.length).fill(-1);
  approachSetback = new Float32Array(segs.length * 2).fill(STOP_SETBACK);
  {
    const zebras = crossingApproaches(net);
    segs.forEach((sg, i) => {
      for (const fwd of [true, false]) {
        const end = fwd ? segB[i] : segA[i];
        if (ringArc[i]) continue;
        const zebra = zebras.get(sg.id)?.[fwd ? 1 : 0] ?? 0;
        approachSetback[i * 2 + (fwd ? 0 : 1)] = stopLine(net, nodeIds[end], zebra) + HOLD_BEHIND_LINE;
      }
    });
    busFrom = new Float32Array(segs.length * 2).fill(-1); busTo = new Float32Array(segs.length * 2).fill(-1);
    segs.forEach((sg, i) => {
      for (const fwd of [true, false]) {
        const span = busLaneSpan(net, sg, fwd, zebras);
        if (span) { busFrom[i * 2 + (fwd ? 0 : 1)] = span.from; busTo[i * 2 + (fwd ? 0 : 1)] = span.to; }
      }
    });
    refreshBusStops();
    // The crossings people use: every zebra the renderer paints.
    crossings = []; walkersOut = 0;
    crossingAt = new Int32Array(segs.length * 2).fill(-1);
    const pose = { x: 0, z: 0, tx: 0, tz: 0 };
    segs.forEach((sg, i) => {
      const ends = zebras.get(sg.id);
      if (!ends) return;
      for (const end of [0, 1] as const) {
        if (!ends[end]) continue;
        Network.poseAt(sg, end ? sg.len - ends[end] : ends[end], pose);
        crossingAt[i * 2 + end] = crossings.length;
        crossings.push({ node: end ? segB[i] : segA[i], seg: i, end, dist: ends[end], cx: pose.x, cz: pose.z, ux: -pose.tz, uz: pose.tx,
          lo: -sideHalf(sg, -1), hi: sideHalf(sg, 1), waiting: [0, 0], lastStep: [-9, -9], rate: 0.01, walkers: [] });
      }
    });
  }
  laneCars = new Array(segs.length * 2 * MAXL);
  for (let i = 0; i < laneCars.length; i++) laneCars[i] = [];
  laneTail = new Float32Array(segs.length * 2 * MAXL);
  laneFresh = new Float32Array(segs.length * 2 * MAXL);
  laneTailV = new Float32Array(segs.length * 2 * MAXL);
  laneLeft = new Int32Array(segs.length * 2 * MAXL).fill(-1);
  // Lanes: how many each way, where each sits, and where along the road each is open at full width.
  // A lane that begins where a narrower road hands over opens after the taper; one that has nothing
  // to carry on into at the far end closes before it, and its traffic has to move over first.
  dirLanes = new Uint8Array(segs.length * 2);
  laneCentreTab = new Float32Array(segs.length * 2 * MAXL);
  laneFromTab = new Float32Array(segs.length * 2 * MAXL);
  laneToTab = new Float32Array(segs.length * 2 * MAXL).fill(1e9);
  segs.forEach((s, i) => {
    for (const fwd of [true, false]) {
      const dk = i * 2 + (fwd ? 0 : 1), n = Math.min(MAXL, lanesFor(net, s, fwd));
      dirLanes[dk] = n;
      for (let l = 0; l < n; l++) laneCentreTab[dk * MAXL + l] = laneCentre(net, s, fwd, l);
      if (!n) continue;
      const tl = taperLength(s);
      const startNode = fwd ? s.a : s.b, endNode = fwd ? s.b : s.a;
      if (net.degree(startNode) === 2) {
        const up = net.segsAt(startNode).find(o => o.id !== s.id)!;
        const upFwd = up.b === startNode;
        if (lanesFor(net, up, upFwd)) {
          const fed = new Set(matchLanes(net, up, upFwd, s, fwd));
          // A new lane can be taken once it has opened out halfway.
          for (let l = 0; l < n; l++) if (!fed.has(l)) laneFromTab[dk * MAXL + l] = tl * 0.5;
        }
      }
      if (net.degree(endNode) === 2) {
        const down = net.segsAt(endNode).find(o => o.id !== s.id)!;
        const downFwd = down.a === endNode;
        if (lanesFor(net, down, downFwd)) matchLanes(net, s, fwd, down, downFwd).forEach((j, l) => { if (j < 0) laneToTab[dk * MAXL + l] = s.len - tl; });
      }
    }
  });
  approachCache = new Map();
  // Signals: each light runs its plan from where the city clock puts it, so an edit elsewhere does
  // not reset every junction's cycle.
  // Keep each signal's clock through the edit when its plan is unchanged (so an adaptive signal does
  // not jump), or its phase when only the plan's timings or movements changed.
  const oldClock = new Map<number, { plan: string; phase: number; t: number; len: number }>();
  sigPlan.forEach((plan, ni) => { if (plan) oldClock.set(oldNodeIds[ni], { plan: JSON.stringify(plan), phase: sigPhase[ni], t: sigT[ni], len: sigLen[ni] }); });
  // A junction nothing can drive through (every arm one way the same way) runs no signal at all.
  sigPlan = nodeIds.map((id, ni) => { if (nodeType[ni] !== J_LIGHT) return null; const plan = planFor(net, id); return plan.phases.length ? plan : null; });
  sigPhase = new Int16Array(nodeIds.length); sigT = new Float32Array(nodeIds.length); sigLen = new Float32Array(nodeIds.length);
  sigApproaches = nodeIds.map(() => []);
  nodeIds.forEach((id, ni) => {
    const plan = sigPlan[ni];
    if (!plan) return;
    const old = oldClock.get(id);
    if (old && old.plan === JSON.stringify(plan)) { sigPhase[ni] = old.phase; sigT[ni] = old.t; sigLen[ni] = old.len; }
    else if (old && old.phase < plan.phases.length) { sigPhase[ni] = old.phase; sigLen[ni] = plan.phases[old.phase].green; sigT[ni] = Math.min(old.t, sigLen[ni] + AMBER + ALL_RED - 0.01); }
    else { const clock = fixedClock(plan, simTime + id * 3.7); sigPhase[ni] = clock.phase; sigT[ni] = clock.t; sigLen[ni] = clock.len; }
    const seen = new Set<string>();
    for (const m of nodeMovements(net, id)) {
      const k = `${m.inSeg}:${m.inFwd}`;
      if (seen.has(k) || !segIndex.has(m.inSeg)) continue;
      seen.add(k); sigApproaches[ni].push({ seg: segIndex.get(m.inSeg)!, fwd: m.inFwd });
    }
  });
  boxCars = nodeIds.map(() => []);
  boxWait = new Int32Array(nodeIds.length).fill(-1);
  movePaths = new Map();
  moveConflicts = new Map();

  // Tile access arrives keyed by segment id; store indices.
  cover = p.cover;
  accS = p.accS;
  accSeg = new Int32Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) {
    const id = p.accSeg[i];
    accSeg[i] = id < 0 ? -1 : segIndex.get(id) ?? -1;
  }
}

let parkReach: Uint8Array = new Uint8Array(N_TILES);
function tileConnected(i: number): boolean {
  return isDecoration(kind[i]) ? !!parkReach[i] : roadConnected(i);
}

function roadConnected(i: number): boolean {
  const s = accSeg[i];
  return s >= 0 && !cover[i] && reach[segA[s]] === 1;
}

// ---- routing -----------------------------------------------------------------------------------
let gScore = new Float32Array(0);
let prevEdgeSeg = new Int32Array(0);
let prevEdgeFwd = new Uint8Array(0);
let prevNode = new Int32Array(0);
let stamp = new Uint32Array(0);
let closedStamp = new Uint32Array(0);
let gen = 0;
const heapF: number[] = [];
const heapN: number[] = [];

function heapPush(f: number, n: number): void {
  heapF.push(f); heapN.push(n);
  let i = heapF.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapF[p] <= heapF[i]) break;
    [heapF[p], heapF[i]] = [heapF[i], heapF[p]];
    [heapN[p], heapN[i]] = [heapN[i], heapN[p]];
    i = p;
  }
}
function heapPop(): number {
  const top = heapN[0];
  const lf = heapF.pop()!, ln = heapN.pop()!;
  if (heapF.length) {
    heapF[0] = lf; heapN[0] = ln;
    let i = 0;
    const len = heapF.length;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < len && heapF[l] < heapF[m]) m = l;
      if (r < len && heapF[r] < heapF[m]) m = r;
      if (m === i) break;
      [heapF[m], heapF[i]] = [heapF[i], heapF[m]];
      [heapN[m], heapN[i]] = [heapN[i], heapN[m]];
      i = m;
    }
  }
  return top;
}

function segTime(i: number): number {
  return (segs[i].len / segSpeed(segs[i])) * (1 + 2.5 * segCong[i]);
}

/**
 * Fastest route between two road positions as a list of legs, or null. With `seed`, each road's cost
 * is varied a little (±ROUTE_JITTER/2) for this trip: drivers do not all judge the same way, so a
 * route that is only barely the fastest does not take everyone.
 */
/**
 * The quickest way from arc length sS on segment sSeg to gS on gSeg. `dir`, if given, is the way it
 * must set off (true: a→b); then it does not turn back along a road at a junction either, but goes
 * round, as a bus leaving the end of its run does.
 */
function route(sSeg: number, sS: number, gSeg: number, gS: number, seed = 0, dir?: boolean): Leg[] | null {
  const S = segs[sSeg];
  const G = segs[gSeg];
  if (!S || !G) return null;
  if (sSeg === gSeg) {
    if (gS >= sS && dir !== false) return [{ seg: sSeg, fwd: true, p0: sS, p1: gS }];
    if (gS < sS && !S.oneway && dir !== true) return [{ seg: sSeg, fwd: false, p0: S.len - sS, p1: S.len - gS }];
  }
  const n = nodeIds.length;
  if (gScore.length < n + 1) {
    gScore = new Float32Array(n + 1);
    prevEdgeSeg = new Int32Array(n + 1);
    prevEdgeFwd = new Uint8Array(n + 1);
    prevNode = new Int32Array(n + 1);
    stamp = new Uint32Array(n + 1);
    closedStamp = new Uint32Array(n + 1);
  }
  gen++;
  heapF.length = 0;
  heapN.length = 0;
  const GOAL = n; // virtual node
  const gx = G.pts[0], gz = G.pts[1];
  const h = (node: number): number => Math.hypot(nodeX[node] - gx, nodeZ[node] - gz) / 4.5 * 0.8;
  const vS = segSpeed(S);
  const relax = (node: number, g: number, from: number, seg: number, fwd: boolean): void => {
    if (closedStamp[node] === gen) return;
    if (stamp[node] === gen && gScore[node] <= g) return;
    stamp[node] = gen;
    gScore[node] = g;
    prevNode[node] = from;
    prevEdgeSeg[node] = seg;
    prevEdgeFwd[node] = fwd ? 1 : 0;
    heapPush(g + (node === GOAL ? 0 : h(node)), node);
  };
  if (dir !== false) relax(segB[sSeg], (S.len - sS) / vS, -1, sSeg, true);
  if (!S.oneway && dir !== true) relax(segA[sSeg], sS / vS, -1, sSeg, false);
  const vG = segSpeed(G);

  while (heapN.length) {
    const cur = heapPop();
    if (closedStamp[cur] === gen) continue;
    closedStamp[cur] = gen;
    if (cur === GOAL) {
      const legs: Leg[] = [];
      let node = GOAL;
      while (node !== -1) {
        const seg = prevEdgeSeg[node];
        const fwd = prevEdgeFwd[node] === 1;
        const from = prevNode[node];
        const len = segs[seg].len;
        if (node === GOAL) legs.push({ seg, fwd, p0: 0, p1: fwd ? gS : len - gS });
        else if (from === -1) legs.push({ seg, fwd, p0: fwd ? sS : len - sS, p1: len });
        else legs.push({ seg, fwd, p0: 0, p1: len });
        node = from;
      }
      legs.reverse();
      return legs;
    }
    const g = gScore[cur];
    // (Setting off a given way, it does not come back to the goal by turning round in a junction either.)
    const uTurnHere = dir !== undefined && prevEdgeSeg[cur] === gSeg && nodeEdges[cur].some(o => o.seg !== gSeg);
    if (cur === segA[gSeg] && !uTurnHere) relax(GOAL, g + gS / vG, cur, gSeg, true);
    if (cur === segB[gSeg] && !G.oneway && !uTurnHere) relax(GOAL, g + (G.len - gS) / vG, cur, gSeg, false);
    for (const e of nodeEdges[cur]) {
      if (dir !== undefined && e.seg === prevEdgeSeg[cur] && nodeEdges[cur].some(o => o.seg !== e.seg)) continue;
      const t = nodeType[e.to];
      const penalty = t === J_LIGHT ? 2.5 : t === J_STOP ? 1.4 : t === J_YIELD ? 0.8 : 0;
      const jitter = seed ? 1 + ROUTE_JITTER * (((Math.sin(e.seg * 12.9898 + seed) * 43758.5453) % 1 + 1) % 1 - 0.5) : 1;
      relax(e.to, g + segTime(e.seg) * jitter + penalty, cur, e.seg, e.fwd);
    }
  }
  return null;
}

// ---- car lifecycle --------------------------------------------------------------------------------
function freeCar(slot: number): void {
  const c = slots[slot];
  if (!c) return;
  releaseLock(c, slot);
  if (c.box >= 0 && c.box < boxCars.length) leaveBox(slot);
  for (let n = 0; n < boxWait.length; n++) if (boxWait[n] === slot) boxWait[n] = -1;
  trafficSpace.remove(slot);
  slots[slot] = null;
  freeList.push(slot);
  activeCars--;
}

function clearCars(): void {
  for (let s = 0; s < MAX_CARS; s++) if (slots[s]) freeCar(s);
  // Hand slots out in the same order as a fresh start. A slot picks its car's lane, so a free list
  // left shuffled by the last city would decide which lanes the next city's traffic uses.
  freeList.length = 0;
  for (let i = MAX_CARS - 1; i >= 0; i--) freeList.push(i);
  lockOwner.fill(-1); ringClaim.fill(-1); spawnSpace.clear();
  for (const list of boxCars) list.length = 0;
  boxWait.fill(-1);
}

const legStart = (l: Leg): number => (l.fwd ? segA[l.seg] : segB[l.seg]);
const legEndNode = (l: Leg): number => (l.fwd ? segB[l.seg] : segA[l.seg]);

/**
 * An arm meets a roundabout at a single point, but the arm's lanes lie to the side of that point —
 * sideways on the arm is *along* the ring. An avenue's outer lane is a full 1.05 off, so a car joining
 * or leaving the ring at the node itself would have to jump that far sideways across the circulating
 * lane, and on the way out backwards into the queue behind it, which gridlocks the whole circle.
 * Slide each transition along the arc to the point where the arm's own lane reaches it: the merge stays
 * continuous whatever the road width, and on a one-tile road the shift is the old ~0.2 and barely moves.
 */
/** Note on each motorway leg whether the route turns off onto a slip road next, or just came off one. */
function markRampLegs(legs: Leg[]): void {
  for (let i = 0; i < legs.length; i++) {
    const seg = segs[legs[i].seg];
    if (!isCarriageway(seg.kind)) continue;
    const next = legs[i + 1], prev = legs[i - 1];
    if (next && segs[next.seg].kind === KIND_RAMP && rampStart[next.seg]) legs[i].toRamp = rampStart[next.seg];
    if (prev && segs[prev.seg].kind === KIND_RAMP && rampEnd[prev.seg]) legs[i].fromRamp = rampEnd[prev.seg];
  }
}

function alignRingLegs(legs: Leg[], vehicle: number): void {
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (!ringArc[leg.seg]) continue;
    const arc = segs[leg.seg];
    const next = legs[i + 1];
    if (next && !ringArc[next.seg] && legEndNode(leg) === legStart(next)) {
      const to = carPose(next, next.p0, vehicle);
      leg.p1 = clamp(Network.nearestOn(arc, to.x, to.z).s, leg.p0 + 0.05, leg.p1);
    }
    const prev = legs[i - 1];
    if (prev && !ringArc[prev.seg] && legEndNode(prev) === legStart(leg)) {
      const from = carPose(prev, prev.p1, vehicle);
      leg.p0 = clamp(Network.nearestOn(arc, from.x, from.z).s, leg.p0, leg.p1 - 0.05);
    }
  }
}

function wiredRoute(sSeg: number, sS: number, gSeg: number, gS: number): Leg[] | null {
  const path = trolleyRoute(trolleyNet, segs[sSeg]?.id ?? -1, sS, segs[gSeg]?.id ?? -1, gS);
  return path?.map(leg => ({ ...leg, seg: trolleySegIndex.get(leg.seg)! })) ?? null;
}

/**
 * How briskly a driver goes, as a share of the road's speed. Everyone drives a little differently:
 * some dawdle, some push on; lorries and buses keep it steady, and blue lights hurry.
 */
function drivingPace(vehicle: number): number {
  const r = Math.random();
  switch (vehicle) {
    case 2: return 0.84 + r * 0.22;
    case 3: case 10: return 0.76 + r * 0.14;
    case 4: case 8: return 0.84 + r * 0.1;
    case 5: case 6: return 1.1 + r * 0.1;
    case 7: return 1;
    case 9: return 0.95 + r * 0.2;
    default: return 0.78 + r * 0.42;
  }
}

function spawnTrip(sSeg: number, sS: number, gSeg: number, gS: number, vehicle = 1, line?: number, mission?: Mission, taxiStop?: number, loop = false): boolean {
  // The last few slots are kept for fire engines, patrols, bin lorries and buses, so a gridlocked
  // city full of commuters can still send out its services.
  const reserve = mission || line !== undefined ? 0 : SERVICE_RESERVE;
  if (freeList.length <= reserve || sSeg < 0 || gSeg < 0) return false;
  // Everyone but a callout judges the roads a little differently.
  const seed = mission ? 0 : 1 + Math.random() * 1000;
  const findRoute = vehicle === 8 ? wiredRoute : (a: number, b: number, c: number, d: number) => route(a, b, c, d, seed);
  let legs = findRoute(sSeg, sS, gSeg, gS);
  if (!legs || legs.length === 0) { noPath++; return false; }
  if (line !== undefined || loop) {
    // A bus does not turn round in the road at the end of its run if it can help it: it drives on and
    // comes back round the block.
    const back = (vehicle !== 8 ? routeOnward(gSeg, gS, legs[legs.length - 1].fwd, sSeg, sS, seed) : null) ?? findRoute(gSeg, gS, sSeg, sS);
    if (!back) return false;
    // The far stop: the bus pulls in there and stands a while before the run back (on the last leg
    // that is driven at all, since an empty one at a node is dropped below).
    const out = legs.filter(l => l.p1 - l.p0 > 1e-3);
    const last = out.length ? out[out.length - 1] : legs[legs.length - 1];
    last.dwell = last.p1;
    // Carrying straight on from the stop, the way back is more of the same leg.
    const first = back[0];
    if (first && first.seg === last.seg && first.fwd === last.fwd && Math.abs(first.p0 - last.p1) < 1e-3 && last === legs[legs.length - 1]) {
      last.p1 = first.p1; last.toRamp = first.toRamp;
      legs.push(...back.slice(1));
    } else legs.push(...back);
  }
  // A trip that starts or ends right on a node has an empty leg there, pointing along a road the car
  // never drives; it would appear facing that way and then spin round on the spot.
  const driven = legs.filter(l => l.p1 - l.p0 > 1e-3);
  if (driven.length) legs = driven;
  // Buses call at the stops on the way; trolleybuses run stop to stop.
  const calls = (line !== undefined || loop) && vehicle !== 8 ? busCalls(legs) : undefined;
  const slot = freeList.at(-1)!;
  markRampLegs(legs);
  alignRingLegs(legs, vehicle);
  const placement = carPose(legs[0], legs[0].p0, vehicle);
  if (!trafficSpace.free(placement) || !spawnSpace.free(placement)) return false;
  freeList.pop(); trafficSpace.set(slot, placement);
  // Traffic from beyond the map edge arrives already at speed; everyone else pulls away from the kerb.
  const pace = drivingPace(vehicle);
  const rolling = entries.some(e => e.seg === legs[0].seg && Math.abs(e.s - legs[0].p0) < 0.05);
  slots[slot] = { uid: ++carSequence, legs, li: 0, p: legs[0].p0, time: 0, v: rolling ? segSpeed(segs[legs[0].seg]) * pace : 0, stood: 0, loop, accel: 0, brakeT: -1, side: 0, sideGoal: 0, yieldUntil: -1, yieldTo: -1, insistent: false, pace, stuck: 0, lock: -1, lockLi: -1, lockStop: 0, lockMask: 0, vehicle, line, mission, taxiStop, ...(calls ? { calls, callIdx: 0 } : {}),
    lane: 0, nextLane: -1, prevLane: 0, chFrom: 0, chP: 0, chT: -1, chLane: 0, lcCool: 0, laneWait: 0, box: -1, boxLi: -1, boxBlockedAt: -1 };
  activeCars++;
  return true;
}

/** How long a bus stands at a stop on the way. */
const CALL_DWELL = 2;

/**
 * The stops a bus makes on its route: every bus stop on the kerb side of a road it drives along, and
 * its far stop (marked on its leg as `dwell`) whichever side that is on. Not where it sets out, nor
 * where it ends. A stop on the kerb side gets a lay-by unless its kerb lane is a bus lane.
 */
function busCalls(legs: Leg[]): Call[] {
  const out: Call[] = [];
  const last = legs.length - 1;
  legs.forEach((l, li) => {
    const sg = segs[l.seg];
    if (ringArc[l.seg] || sg.structure) return;
    for (const st of [...busStops, ...probeStops]) {
      if (st.seg !== l.seg || st.side !== (l.fwd ? 1 : -1)) continue;
      const p = l.fwd ? st.s : sg.len - st.s;
      if (p < l.p0 + 0.3 || p > l.p1 + 1e-6 || (li === last && p > l.p1 - 0.3) || (li === 0 && p < l.p0 + 0.6)) continue;
      out.push({ li, p, far: false, bay: st.bay });
    }
  });
  const fi = legs.findIndex(l => l.dwell !== undefined);
  if (fi >= 0) {
    const f = legs[fi], sg = segs[f.seg], at = f.dwell!;
    delete f.dwell;
    // The far stop gets its lay-by too when it is on the kerb side (not where the bus turns round in
    // the road, though: it stands in its lane for that).
    const side = [...busStops, ...probeStops].find(st => st.seg === f.seg && Math.abs((f.fwd ? st.s : sg.len - st.s) - at) < 0.05);
    const kerbSide = !!side && side.bay && side.side === (f.fwd ? 1 : -1) && !(at >= f.p1 - 1e-3 && legs[fi + 1] && isUTurn(f, legs[fi + 1]));
    for (let k = out.length - 1; k >= 0; k--) if (out[k].li === fi && Math.abs(out[k].p - at) < 0.6) out.splice(k, 1);
    out.push({ li: fi, p: at, far: true, bay: kerbSide });
  }
  return out.sort((a, b) => a.li - b.li || a.p - b.p);
}

/**
 * The way from arc length s on `seg`, setting off in direction `fwd`, to gS on gSeg without turning
 * round: on to the node ahead, then the quickest way from there that does not go straight back (unless
 * the road ends there). Searched from each way out of that node, since the route search visits a node
 * only once and so could not come back through it from another side.
 */
function routeOnward(seg: number, s: number, fwd: boolean, gSeg: number, gS: number, seed: number): Leg[] | null {
  const sg = segs[seg];
  if (seg === gSeg && (fwd ? gS >= s : gS <= s)) return route(seg, s, gSeg, gS, seed, fwd);
  if (!fwd && sg.oneway) return null;
  const node = fwd ? segB[seg] : segA[seg];
  const first: Leg = { seg, fwd, p0: fwd ? s : sg.len - s, p1: sg.len };
  const deadEnd = !nodeEdges[node].some(o => o.seg !== seg);
  let best: Leg[] | null = null, bestCost = Infinity;
  for (const e of nodeEdges[node]) {
    if (e.seg === seg && !deadEnd) continue;
    const es = segs[e.seg];
    const rest = route(e.seg, e.fwd ? 0 : es.len, gSeg, gS, seed, e.fwd);
    if (!rest) continue;
    const cost = legsCost(rest);
    if (cost < bestCost) { bestCost = cost; best = rest; }
  }
  return best ? [first, ...best.filter(l => l.p1 - l.p0 > 1e-3)] : null;
}

function externalTrip(tile: number, inbound: boolean, vehicle = 1): boolean {
  // Try the closest entrance first, then fall back when one-way roads prevent the route.
  const candidates = [...entries].sort((a, b) => {
    const pa = segs[a.seg], pb = segs[b.seg];
    return Math.hypot(pa.pts[0] - tile % GRID, pa.pts[1] - Math.floor(tile / GRID)) - Math.hypot(pb.pts[0] - tile % GRID, pb.pts[1] - Math.floor(tile / GRID));
  });
  for (const e of candidates) {
    const legs = inbound ? route(e.seg, e.s, accSeg[tile], accS[tile]) : route(accSeg[tile], accS[tile], e.seg, e.s);
    if (!legs) continue;
    return inbound ? spawnTrip(e.seg, e.s, accSeg[tile], accS[tile], vehicle) : spawnTrip(accSeg[tile], accS[tile], e.seg, e.s, vehicle);
  }
  noPath++; return false;
}

/**
 * A trip in or out of the city that a railway out of town can carry instead of the road. Stations
 * only take what they have room for, so a single line does not swallow a city's worth of traffic.
 */
function byIntercityRail(tile: number): boolean {
  if (railTokens < 1) return false;
  const radius = SERVICES[T_STATION].radius!;
  if (!transit.intercity.some(station => distance(station, tile) < radius)) return false;
  if (Math.random() > 0.6) return false;
  railTokens--; railWindow++; riderWindow++; money += 0.12 * effects.fare;
  return true;
}

/** Whether the city clock says it is late enough for the racers to come out. */
/**
 * The hour on the city's clock, as the player sees it (render/daylight): the day starts at 9:00 and
 * lasts `dayLength` seconds (480 unless the settings change it).
 */
let dayLength = 480;
const cityHour = (): number => (((9 + ((tick + subCount / SIM_HZ) * 24) / dayLength) % 24) + 24) % 24;
const nightTime = (): boolean => { const h = cityHour(); return h > 22 || h < 4; };

/**
 * Street racers: a handful of cars that run a long route across the city at speed once the streets
 * are quiet. They are ordinary traffic in every other way, so they queue and crash like anyone else.
 */
function startRace(): void {
  if (!resTiles.length || !jobTiles.length) return;
  for (let n = 0; n < 3; n++) {
    const o = pickWeighted(resTiles, resW), d = pickWeighted(jobTiles, jobW);
    if (distance(o, d) < 20) continue;
    spawnTrip(accSeg[o], accS[o], accSeg[d], accS[d], 7);
  }
}

/** Four cabs per stand; full fleets and blocked roads fall back to the ordinary commute. */
function taxiTrip(origin: number, destination: number): boolean {
  if (!taxiStops.length || Math.random() >= 0.4) return false;
  const stop = taxiStopForTrip(taxiStops, origin, destination, stand =>
    slots.reduce((n, car) => n + (car?.taxiStop === stand ? 1 : 0), 0) < SERVICES[T_TAXI].capacity! &&
    !!route(accSeg[stand], accS[stand], accSeg[destination], accS[destination]));
  return stop >= 0 && spawnTrip(accSeg[stop], accS[stop], accSeg[destination], accS[destination], 9, undefined, undefined, stop);
}

/** Of a few candidates drawn by weight, the one a person picks: nearer ones likelier (a gravity model). */
function nearby(tiles: number[], w: number[], from: number): number {
  const cands = [0, 1, 2, 3].map(() => pickWeighted(tiles, w));
  const fx = from % GRID, fz = Math.floor(from / GRID);
  return cands[pickByDistance(cands.map(t => Math.hypot(t % GRID - fx, Math.floor(t / GRID) - fz)), Math.random())];
}
/** The shops among the job tiles, with their weights, for errands. */
let comCache: { stamp: number; tiles: number[]; w: number[] } | null = null;
function comTiles(): { tiles: number[]; w: number[] } {
  if (!comCache || comCache.stamp !== jobTiles.length + jobW.length * 7) {
    // Job weights are running totals (for pickWeighted); the shops get running totals of their own.
    const tiles: number[] = [], w: number[] = [];
    let total = 0;
    jobTiles.forEach((t, k) => { if (zoneBase(kind[t]) === T_COM) { total += jobW[k] - (k ? jobW[k - 1] : 0); tiles.push(t); w.push(total); } });
    comCache = { stamp: jobTiles.length + jobW.length * 7, tiles, w };
  }
  return comCache;
}

function spawn(dt: number): void {
  taxiWindow *= Math.exp(-dt / 60);
  airTokens = Math.min(transit.airports.length * 240, airTokens + transit.airports.length * 4 * dt);
  const intercityCapacity = transit.intercity.length * SERVICES[T_STATION].capacity!;
  railTokens = Math.min(intercityCapacity, railTokens + transit.intercity.length * 6 * dt);
  riderWindow *= Math.exp(-dt / 60); airWindow *= Math.exp(-dt / 60); railWindow *= Math.exp(-dt / 60); tollWindow *= Math.exp(-dt / 60);
  transit.lines.forEach((line, i) => {
    const congestion = (line.mode === 'bus' || line.mode === 'trolley') ? Math.max(segCong[accSeg[line.a]] ?? 0, segCong[accSeg[line.b]] ?? 0) : 0;
    transitTokens[i] = Math.min(line.capacity, (transitTokens[i] ?? 0) + line.capacity / 20 * dt * (1 - congestion * 0.8));
    transitDepartures[i] = (transitDepartures[i] ?? 0) + dt;
    if (!racing && (line.mode === 'bus' || line.mode === 'trolley') && transitDepartures[i] >= 12 && !slots.some(c => c?.line === i)) {
      if (spawnTrip(accSeg[line.a], accS[line.a], accSeg[line.b], accS[line.b], line.mode === 'trolley' ? 8 : 4, i)) transitDepartures[i] = 0;
    }
  });
  // After dark, and only in a city big enough to have a scene, the racers come out for a while.
  if (!racing && cityLevel >= 3 && raceUntil < simTime && nightTime() && Math.random() < 0.0016 * dt * SIM_HZ) {
    raceUntil = simTime + 45;
    startRace();
  }
  // The day's rhythm: peaks morning and evening, a trickle in the small hours, the same trips in all.
  const hour = cityHour(), rhythm = dayProfile(hour);
  spawnBudget = Math.min(8, spawnBudget + tripRate * dt * trafficScale * rhythm);
  extBudget = Math.min(4, extBudget + extRate * dt * trafficScale * rhythm);
  // Through traffic keeps rolling whatever the city does; it never counts towards commutes.
  throughBudget = Math.min(2, throughBudget + THROUGH_RATE * dt * trafficScale);
  if (throughBudget >= 1 && freeList.length > 60 && !racing) { throughBudget -= 1; throughTrip(); }
  // Freight: trucks carry goods from factories and farms to the shops, and the surplus out of town.
  freightBudget = Math.min(2, freightBudget + Math.min(0.12, (goods.local + goods.exported) / 60 * 0.006) * dt);
  if (freightBudget >= 1 && freeList.length > 40 && !racing) {
    freightBudget -= 1;
    const makers = jobTiles.filter(t => zoneBase(kind[t]) === T_IND);
    const origin = makers[Math.floor(Math.random() * makers.length)];
    if (origin !== undefined) {
      if (goods.exported > 0 && entries.length && Math.random() < goods.exported / Math.max(1, goods.local + goods.exported)) externalTrip(origin, false, 3);
      else {
        const shops = jobTiles.filter(t => zoneBase(kind[t]) === T_COM);
        const shop = shops[Math.floor(Math.random() * shops.length)];
        // Deliveries round town go by van; the long lorries are for the run out of town.
        if (shop !== undefined) spawnTrip(accSeg[origin], accS[origin], accSeg[shop], accS[shop], 2);
      }
    }
  }
  let n = 0;
  while (spawnBudget >= 1 && n < 4 && resTiles.length && jobTiles.length) {
    spawnBudget -= 1;
    n++;
    // What the trip is for at this hour: to work, home again, or to the shops, mostly not far.
    const purpose = purposeAt(hour, Math.random());
    let o: number, d: number;
    if (purpose === 'home') { const work = pickWeighted(jobTiles, jobW); o = work; d = nearby(resTiles, resW, work); }
    else {
      o = pickWeighted(resTiles, resW);
      const shops = purpose === 'shop' ? comTiles() : null;
      d = shops && shops.tiles.length ? nearby(shops.tiles, shops.w, o) : nearby(jobTiles, jobW, o);
    }
    const line = transitLineForTrip(transit, o, d);
    if (line >= 0 && transitTokens[line] >= 1 && Math.random() < Math.min(0.98, (['bus', 'trolley'].includes(transit.lines[line].mode) ? 0.65 : 0.9) * effects.transitShare)) {
      transitTokens[line]--; riderWindow++; money += 0.08 * effects.fare;
    } else if (taxiTrip(o, d)) {
      // Passenger boards at the stand; fare is collected only after reaching the destination.
    } else if (Math.random() < effects.carTrips) {
      money += effects.toll; tollWindow += effects.toll ? 1 : 0;
      spawnTrip(accSeg[o], accS[o], accSeg[d], accS[d], tileHash(o) < 0.2 ? 2 : 1);
    }
  }
  if (!entries.length) return;
  while (extBudget >= 1 && n < 6 && freeList.length) {
    extBudget -= 1;
    n++;
    // Outside workers drive in when there are spare jobs; residents drive out when there are not enough.
    const inbound = comJobs + indJobs + officeJobs > pop * 0.5 ? Math.random() < 0.7 : Math.random() < 0.3;
    if (inbound && jobTiles.length) {
      const d = pickWeighted(jobTiles, jobW);
      if (airTokens >= 1 && transit.airports.some(a => distance(a, d) < 24) && Math.random() < 0.45) { airTokens--; airWindow++; money += 0.2 * effects.fare; }
      else if (byIntercityRail(d)) { /* arrived by train */ }
      else externalTrip(d, true, zoneBase(kind[d]) === T_IND ? 3 : 2);
    } else if (resTiles.length) {
      const o = pickWeighted(resTiles, resW);
      if (!byIntercityRail(o)) externalTrip(o, false);
    }
  }
  // New residents arrive by road.
  while (pendingMoveIns.length && n < 8 && freeList.length) {
    const t = pendingMoveIns.pop()!;
    n++;
    if (accSeg[t] >= 0) externalTrip(t, true, 2);
  }
}

/**
 * Sideways offset of a car from its segment's centreline, positive to the driver's right.
 * A roundabout ring circulates in a single lane on the arc centreline: side by side lanes on a tight
 * circle put the inner one on a measurably shorter path than the arc length the car-following gap is
 * measured in, so inner-lane cars close up until their bodies overlap, and an outer lane wide enough
 * for an avenue reaches out across the mouth of every entry arm.
 */
/** Which lane a car is in, for the probe. */
const carLane = (c: Car): number => c.lane;

/** Travel speed on a road, slowed where the street has been calmed. */
function segSpeed(seg: RSeg): number {
  return SPEED[seg.kind] * (seg.calm ? 0.55 : 1);
}

/** The per-lane queue a car in lane `lane` of this leg belongs to. */
const laneKey = (seg: number, fwd: boolean, lane: number): number => (seg * 2 + (fwd ? 0 : 1)) * MAXL + lane;
const dirKeyOf = (key: number): number => Math.floor(key / MAXL);
const legLanes = (l: Leg): number => Math.max(1, dirLanes[l.seg * 2 + (l.fwd ? 0 : 1)]);
/** Where the middle of a lane of a leg sits, to the right of travel. */
const centreOf = (l: Leg, lane: number): number => laneCentreTab[(l.seg * 2 + (l.fwd ? 0 : 1)) * MAXL + Math.max(0, Math.min(legLanes(l) - 1, lane))];
const smoothstep = (u: number): number => { const v = u < 0 ? 0 : u > 1 ? 1 : u; return v * v * (3 - 2 * v); };
const LC_DIST = 1.6, LC_TIME = 1.4;

/** A slip road leaves and rejoins along the carriageway's lane on its side, easing onto its own centre line. */
function rampOffset(segIndex: number, seg: RSeg, progress: number): number {
  if (seg.kind !== KIND_RAMP) return 0;
  const lane = rampLane[segIndex] || 0.44;
  const mouth = rampMouth[segIndex] || 1;
  if (rampStart[segIndex] && progress < mouth) return rampStart[segIndex] * lane * (1 - progress / mouth);
  if (rampEnd[segIndex] && seg.len - progress < mouth) return rampEnd[segIndex] * lane * (1 - (seg.len - progress) / mouth);
  return 0;
}

/**
 * How far to the right of its leg's centre line car `c` is drawn on leg `li` at progress `p`: in the
 * middle of its lane, sliding across while it changes lanes, in the lane it chose on the next leg,
 * or the one it left on the last. Trolleybuses keep to their wires.
 */
function latOf(c: Car, li: number, p: number): number {
  const leg = c.legs[li], seg = segs[leg.seg];
  const along = leg.fwd ? p : seg.len - p;
  let lat: number;
  if (li === c.li) {
    lat = centreOf(leg, c.lane);
    if (c.chT >= 0) lat = c.chFrom + (lat - c.chFrom) * smoothstep(Math.max((p - c.chP) / LC_DIST, (simTime - c.chT) / LC_TIME));
    lat += c.side ?? 0;
  } else if (li === c.li + 1) lat = centreOf(leg, c.nextLane >= 0 ? c.nextLane : 0);
  else lat = centreOf(leg, c.prevLane);
  // A ramp's own offset is measured along the ramp; on a ring there is only the one lane.
  return ringArc[leg.seg] ? lat : lat + rampOffset(leg.seg, seg, along) * (leg.fwd ? 1 : -1);
}

function carPoseAt(leg: Leg, progress: number, type: number, lane: number): VehiclePose {
  const seg = segs[leg.seg];
  const p = { x: 0, z: 0, tx: 0, tz: 0 };
  Network.poseAt(seg, leg.fwd ? progress : seg.len - progress, p);
  const dir = leg.fwd ? 1 : -1, tx = p.tx * dir, tz = p.tz * dir;
  return { y: roadHeight(seg, leg.fwd ? progress : seg.len - progress), x: p.x - tz * lane, z: p.z + tx * lane, angle: Math.atan2(tx, tz), type };
}

/** A pose in lane `lane` of a leg, for placing a car before it has a record (spawning, lining up on a ring). */
function carPose(leg: Leg, progress: number, type: number, lane = 0): VehiclePose {
  const seg = segs[leg.seg];
  const lat = centreOf(leg, type === 8 ? 0 : lane) + (ringArc[leg.seg] ? 0 : rampOffset(leg.seg, seg, leg.fwd ? progress : seg.len - progress) * (leg.fwd ? 1 : -1));
  return carPoseAt(leg, progress, type, lat);
}

/** How far either side of a junction a turning vehicle eases round the corner instead of pivoting on the spot. */
const CORNER = 0.55;
/** How far along the way back a vehicle turning round in the road takes to swing into the other lane. */
const U_TURN = 0.7;
/** Turning round in the middle of a road, not at a node (a dead end turns round in its own way). */
const isUTurn = (a: Leg, b: Leg): boolean => a.seg === b.seg && a.fwd !== b.fwd && a.p1 < segs[a.seg].len - 0.01;
/** Whether the car turns round in the road at the end of its current leg. */
const uTurnAfter = (c: Car): boolean => !!c.legs[c.li + 1] && isUTurn(c.legs[c.li], c.legs[c.li + 1]);

/**
 * Whether a vehicle can turn round in the road now: nothing coming the other way that could not stop
 * in comfort short of where it swings in, nor in the way of the turn.
 */
function canUTurn(c: Car): boolean {
  const back = c.legs[c.li + 1], half = vehicleLength(c.vehicle) / 2;
  for (let l = 0; l < legLanes(back); l++) for (const o of laneCars[laneKey(back.seg, back.fwd, l)]) {
    const oc = slots[o];
    if (!oc || oc === c) continue;
    const reach = back.p0 - oc.p; // how far short of the turn it is
    if (reach < -(U_TURN + half + vehicleLength(oc.vehicle) / 2 + 0.1)) continue; // gone past
    if (reach < (oc.v * oc.v) / (2 * driverFor(oc.vehicle).b) + half + vehicleLength(oc.vehicle) / 2 + 0.3) return false;
  }
  return true;
}
const lerpPose = (a: VehiclePose, b: VehiclePose, t: number): { x: number; z: number } => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

/**
 * Where a vehicle is drawn as it goes round a corner. The traffic model hands a car from one link to
 * the next at the node, turning it in one step; drawn like that it spins through 90 degrees on the
 * spot. Over the last stretch of one link and the first of the next the car instead follows a
 * quadratic curve from its lane on the way in to its lane on the way out, bending about the junction,
 * and faces along the curve. The traffic space checks the same pose, so what is drawn never overlaps.
 */
function cornerPose(c: Car, li: number, p: number): VehiclePose | null {
  const leg = c.legs[li];
  let fi = -1, ti = -1, along = 0, ra = 0, rb = 0;
  // A corner starts where the lane it turns into would cross this one, at the least: a kerb lane on
  // a wide road lies well out from the centre line, and turning any later hooks back across the box.
  const reach = (l: Leg, other: number): number => Math.min(Math.max(CORNER, Math.abs(other) + 0.15), (l.p1 - l.p0) * 0.45);
  const next = c.legs[li + 1], prev = c.legs[li - 1];
  // Turning round in the road (a bus at the end of its run): it stands straight at its stop, and turns
  // once under way on the way back, swinging forward and across into the other lane.
  if (next && isUTurn(leg, next)) return null;
  if (prev && isUTurn(prev, leg)) {
    if (p - leg.p0 >= U_TURN) return null;
    const start = carPoseAt(prev, prev.p1, c.vehicle, centreOf(prev, li === c.li + 1 ? c.lane : c.prevLane)), end = carPoseAt(leg, leg.p0 + U_TURN, c.vehicle, latOf(c, li, leg.p0 + U_TURN));
    const t = (p - leg.p0) / U_TURN, u = 1 - t;
    const ax = Math.sin(start.angle), az = Math.cos(start.angle);
    // Straight ahead of where it stood, so it pulls away along its lane before it swings round.
    const control = { x: start.x + ax * U_TURN, z: start.z + az * U_TURN };
    const x = u * u * start.x + 2 * u * t * control.x + t * t * end.x, z = u * u * start.z + 2 * u * t * control.z + t * t * end.z;
    const dx = u * (control.x - start.x) + t * (end.x - control.x), dz = u * (control.z - start.z) + t * (end.z - control.z);
    return { ...carPoseAt(leg, p, c.vehicle, latOf(c, li, p)), x, z, angle: Math.atan2(dx, dz) };
  }
  // Measured from the lanes' own centres, not where the car happens to be mid lane change, so the
  // corner does not move under a car already rounding it.
  const laneAt = (l: number): number => c.vehicle === 8 ? 0 : centreOf(c.legs[l], l === c.li ? c.lane : l === c.li + 1 ? Math.max(0, c.nextLane) : c.prevLane);
  const here = laneAt(li);
  if (next && leg.p1 - p < reach(leg, laneAt(li + 1))) {
    const there = laneAt(li + 1);
    fi = li; ti = li + 1; ra = reach(leg, there); rb = reach(next, here); along = ra - (leg.p1 - p);
  } else if (prev && p - leg.p0 < reach(leg, laneAt(li - 1))) {
    const there = laneAt(li - 1);
    fi = li - 1; ti = li; ra = reach(prev, here); rb = reach(leg, there); along = ra + (p - leg.p0);
  }
  if (fi < 0 || ra <= 1e-3 || rb <= 1e-3) return null;
  const from = c.legs[fi], to = c.legs[ti];
  const start = carPoseAt(from, from.p1 - ra, c.vehicle, latOf(c, fi, from.p1 - ra)), end = carPoseAt(to, to.p0 + rb, c.vehicle, latOf(c, ti, to.p0 + rb));
  let turn = end.angle - start.angle;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  if (Math.abs(turn) < 0.12) return null; // near enough straight on
  // Bend about the corner where the two lanes would meet, so the curve leaves one lane and joins the
  // other along their own directions and the car faces along it. Where the lanes do not meet ahead
  // of the car (a U-turn, an awkward roundabout mouth) bend about the junction and turn steadily.
  const ax = Math.sin(start.angle), az = Math.cos(start.angle), bx = Math.sin(end.angle), bz = Math.cos(end.angle);
  const gx = end.x - start.x, gz = end.z - start.z, cross = ax * bz - az * bx;
  // start + s0·a = end − s1·b: how far the corner lies ahead of the start and behind the end.
  const s0 = Math.abs(cross) > 0.2 ? (gx * bz - gz * bx) / cross : -1, s1 = Math.abs(cross) > 0.2 ? (ax * gz - az * gx) / cross : -1;
  const meet = s0 > 0.02 && s1 > 0.02 && s0 < 2 * (ra + rb) && s1 < 2 * (ra + rb);
  const control = meet ? { x: start.x + ax * s0, z: start.z + az * s0 } : lerpPose(carPoseAt(from, from.p1, c.vehicle, latOf(c, fi, from.p1)), carPoseAt(to, to.p0, c.vehicle, latOf(c, ti, to.p0)), 0.5);
  const t = Math.max(0, Math.min(1, along / (ra + rb))), u = 1 - t;
  const x = u * u * start.x + 2 * u * t * control.x + t * t * end.x;
  const z = u * u * start.z + 2 * u * t * control.z + t * t * end.z;
  const own = carPoseAt(leg, p, c.vehicle, latOf(c, li, p));
  const dx = u * (control.x - start.x) + t * (end.x - control.x), dz = u * (control.z - start.z) + t * (end.z - control.z);
  return { ...own, x, z, angle: meet && dx * dx + dz * dz > 1e-8 ? Math.atan2(dx, dz) : start.angle + turn * t };
}

/** Where a vehicle on its `li`th leg at progress `p` actually is: in its lane, or rounding a corner. */
function vehiclePose(c: Car, li: number, p: number): VehiclePose {
  return cornerPose(c, li, p) ?? carPoseAt(c.legs[li], p, c.vehicle, latOf(c, li, p));
}

// ---- lanes: turn tables, choosing a lane, changing lanes ------------------------------------------
/** The turn table for arriving along a leg at its end node, with exits in segment indices. */
function approachOf(l: Leg): NonNullable<ReturnType<typeof approachCache.get>> {
  const dk = l.seg * 2 + (l.fwd ? 0 : 1);
  let a = approachCache.get(dk);
  if (!a) {
    const seg = segs[l.seg];
    const raw = approachLanes(laneNet, l.fwd ? seg.b : seg.a, seg, l.fwd);
    const index = trolleySegIndex;
    a = { exits: raw.exits.map(e => ({ ...e, seg: index.get(e.seg) ?? -1 })), serve: raw.serve, targets: raw.targets };
    approachCache.set(dk, a);
  }
  return a;
}

const exitOf = (a: ReturnType<typeof approachOf>, next: Leg): number => a.exits.findIndex(e => e.seg === next.seg && e.fwd === next.fwd);

/**
 * The lanes of leg `li` that lead where the car goes next. Where the next node only joins two roads
 * (a lane opening or closing, a change of road), it looks on through to the turn after it: a driver
 * heading for a turn pocket just beyond gets into the lane beside it beforehand, not on the pocket's
 * few metres.
 */
function wantedOn(c: Car, li: number, depth = 0): number[] | null {
  const leg = c.legs[li], next = c.legs[li + 1];
  if (!leg || !next || ringArc[leg.seg]) return null;
  const a = approachOf(leg), e = exitOf(a, next);
  if (e < 0) return null;
  const n = legLanes(leg), out: number[] = [];
  for (let l = 0; l < n; l++) if (a.serve[l]?.includes(e)) out.push(l);
  if (!out.length) return null;
  const node = legEndNode(leg);
  if (depth < 3 && nodeType[node] === J_PLAIN && a.exits.length === 1 && c.legs[li + 2]) {
    const ahead = wantedOn(c, li + 1, depth + 1);
    if (ahead) {
      // Of the lanes that carry on, those landing closest to a lane that goes the right way.
      const dist = (l: number): number => Math.min(...a.targets(l, e).map(t => Math.min(...ahead.map(w => Math.abs(w - t)))));
      const best = Math.min(...out.map(dist));
      return out.filter(l => dist(l) === best);
    }
  }
  return out;
}

/** Who may drive in a bus lane: buses, trolleybuses, taxis with a fare, and callouts. */
const busUser = (c: Car): boolean => c.vehicle === 4 || c.vehicle === 8 || c.taxiStop !== undefined || onCallout(c);

/** Whether lane 0 of the leg is a bus lane at progress p, or is about to be just ahead of it. */
function busLaneAt(leg: Leg, p: number): boolean {
  const k = leg.seg * 2 + (leg.fwd ? 0 : 1);
  return busTo[k] >= 0 && p < busTo[k] && p > busFrom[k] - 1;
}

/**
 * Whether the car may not be in lane 0 here: a bus lane, and it has no right to it. A car arriving at
 * a lot along it may cross into it for the last stretch, as drivers may to reach property.
 */
function barredFromKerb(c: Car): boolean {
  const leg = c.legs[c.li];
  if (busUser(c) || legLanes(leg) < 2 || !busLaneAt(leg, c.p)) return false;
  return !(c.li === c.legs.length - 1 && leg.p1 - c.p < BUS_BAY);
}

/**
 * Which lane of a roundabout's ring a car takes for the ring legs from `li` on: the outer lane (0) for
 * a first exit, up to about a third of the way round; the inner lane (1) for anything further, on a
 * ring with two lanes.
 */
function ringLaneFor(c: Car, li: number): number {
  const first = c.legs[li];
  if (!first || !ringArc[first.seg] || legLanes(first) < 2) return 0;
  let round = 0;
  for (let k = li; k < c.legs.length && ringArc[c.legs[k].seg]; k++) round += c.legs[k].p1 - c.legs[k].p0;
  return round <= ringLength[first.seg] * 0.3 ? 0 : 1;
}

function wantedLanes(c: Car): number[] | null {
  if (c.vehicle === 8) return null;
  const leg = c.legs[c.li], n = legLanes(leg);
  // Coming up to a two-lane roundabout: the kerb lane for the outer ring lane, the next for the inner.
  const nextLeg = c.legs[c.li + 1];
  if (nextLeg && ringArc[nextLeg.seg] && !ringArc[leg.seg] && n > 1 && legLanes(nextLeg) > 1 && !barredFromKerb(c)) return [Math.min(n - 1, ringLaneFor(c, c.li + 1))];
  // A bus with a stop coming up on this road gets over to the kerb for it.
  const call = c.calls?.[c.callIdx ?? 0];
  if (call && call.li === c.li && call.p - c.p < 8 && n > 1) return [0];
  const want = wantedOn(c, c.li);
  // A bus keeps to its lane along the span, and moves out towards the end if its turn needs it.
  if (c.vehicle === 4 && want && !want.includes(0) && n > 1 && busLaneAt(leg, c.p) && c.p < busTo[leg.seg * 2 + (leg.fwd ? 0 : 1)] - 2.5) return [0, ...want];
  if (!barredFromKerb(c)) return want;
  // Out of the bus lane: a car turning kerbside waits beside it until the bay before the junction.
  const open = (want ?? Array.from({ length: n }, (_, l) => l)).filter(l => l !== 0);
  return open.length ? open : [1];
}

/** Pick the lane to take on the next leg, if not picked yet: of those its lane may turn into, the one with most room. */
function chooseNext(c: Car): void {
  if (c.nextLane >= 0) return;
  const leg = c.legs[c.li], next = c.legs[c.li + 1];
  if (!next) return;
  if (c.vehicle === 8) { c.nextLane = 0; return; }
  // Round a roundabout: the ring lane chosen on entry, kept all the way round.
  if (ringArc[next.seg]) { c.nextLane = ringArc[leg.seg] ? Math.min(c.lane, legLanes(next) - 1) : ringLaneFor(c, c.li + 1); return; }
  const a = approachOf(leg), e = exitOf(a, next), n = legLanes(next);
  let options = e >= 0 ? a.targets(c.lane, e).filter(l => l >= 0 && l < n) : [];
  if (!options.length) options = [Math.min(n - 1, c.lane)];
  // Onto a road with a bus lane: others take a general lane if their turn allows, a bus takes its own.
  if (n > 1 && busTo[next.seg * 2 + (next.fwd ? 0 : 1)] >= 0) {
    if (c.vehicle === 4 && options.includes(0)) options = [0];
    else if (!busUser(c) && options.some(l => l !== 0)) options = options.filter(l => l !== 0);
  }
  let best = options[0], room = -Infinity;
  for (const l of options) {
    const r = laneTail[laneKey(next.seg, next.fwd, l)] - next.p0;
    if (r > room + 0.05) { room = r; best = l; }
  }
  c.nextLane = best;
}

/** Whether lane `lane` of the car's leg is open at full width at progress p (not still opening or already closing). */
function laneOpen(leg: Leg, lane: number, p: number): boolean {
  const k = (leg.seg * 2 + (leg.fwd ? 0 : 1)) * MAXL + lane;
  return p >= laneFromTab[k] && p <= laneToTab[k] - LC_DIST;
}

/** Cars that moved into a lane during this step, so two cars do not both take the same gap. */
const laneJoin = new Map<number, number[]>();

/** Is there a gap for car `c` alongside in lane `lane`? */
function gapIn(c: Car, slot: number, lane: number): boolean {
  const leg = c.legs[c.li], key = laneKey(leg.seg, leg.fwd, lane), len = vehicleLength(c.vehicle);
  const gap = GAP[segs[leg.seg].kind];
  const check = (other: number): boolean => {
    if (other === slot) return true;
    const o = slots[other];
    if (!o) return true;
    const ol = o.legs[o.li];
    if (ol.seg !== leg.seg || ol.fwd !== leg.fwd) return true;
    const d = o.p - c.p, half = (len + vehicleLength(o.vehicle)) / 2, T = driverFor(c.vehicle).T;
    // Room ahead to close up on at its own speed, and room behind for the car there not to brake hard.
    if (d >= 0) return d > Math.max(gap, half + 0.06) + 0.1 + c.v * T * 0.3;
    return -d > half + 0.25 + o.v * driverFor(o.vehicle).T * 0.6;
  };
  for (const other of laneCars[key]) if (!check(other)) return false;
  for (const other of laneJoin.get(key) ?? []) if (!check(other)) return false;
  return true;
}

function onSolidStretch(c: Car): boolean {
  const leg = c.legs[c.li];
  if (!c.legs[c.li + 1] || nodeType[legEndNode(leg)] === J_PLAIN || nodeType[legEndNode(leg)] === J_RING) return false;
  return leg.p1 - c.p < approachSetback[leg.seg * 2 + (leg.fwd ? 0 : 1)] - HOLD_BEHIND_LINE + SOLID_STRETCH;
}

/**
 * Change lanes when the car is in a lane that does not lead where it is going (mandatory, tried
 * often), or when it could get past a slow or stopped car ahead in another lane that also leads
 * there (overtaking, now and then). The car switches queues at once and slides across as it drives.
 */
function considerLaneChange(c: Car, slot: number, leaderGap: number, leaderStuck: boolean): void {
  // Once admitted to a junction box the movement it was checked for is fixed.
  if (c.chT >= 0 || simTime < c.lcCool || c.vehicle === 8 || c.working || c.box >= 0) return;
  const leg = c.legs[c.li];
  const makingWay = c.yieldUntil > simTime && onCallout(slots[c.yieldTo]);
  const barred = c.lane === 0 && barredFromKerb(c);
  if (ringArc[leg.seg] || (!c.legs[c.li + 1] && !makingWay && !barred)) return;
  const n = legLanes(leg);
  if (n < 2) return;
  const want = wantedLanes(c);
  const ok = (l: number): boolean => l >= 0 && l < n && laneOpen(leg, l, c.p) && (!want || want.includes(l));
  const closing = c.p > laneToTab[(leg.seg * 2 + (leg.fwd ? 0 : 1)) * MAXL + c.lane] - LC_DIST * 2.5;
  let target = -1, mandatory = false;
  if (makingWay) {
    // A callout behind: move out of its lane, whichever side has room.
    mandatory = true;
    for (const l of [c.lane - 1, c.lane + 1]) if (target < 0 && l >= 0 && l < n && laneOpen(leg, l, c.p) && gapIn(c, slot, l)) target = l;
  } else if ((want && !want.includes(c.lane)) || closing) {
    mandatory = true;
    // Step one lane towards the nearest lane that goes the right way.
    const goals = want ?? Array.from({ length: n }, (_, l) => l).filter(l => l !== c.lane);
    const goal = goals.reduce((b, l) => Math.abs(l - c.lane) < Math.abs(b - c.lane) ? l : b, goals[0]);
    target = c.lane + Math.sign(goal - c.lane);
    if (!(target >= 0 && target < n && laneOpen(leg, target, c.p))) target = -1;
  } else if (c.vehicle === 4 && c.lane > 0 && busLaneAt(leg, c.p) && (!want || want.includes(0)) && laneOpen(leg, c.lane - 1, c.p)) {
    // A bus moves into its lane when it can.
    target = c.lane - 1;
  } else if (leaderGap < 1.2 && leaderStuck && !onSolidStretch(c)) {
    // Try the neighbour with the longer clear run ahead.
    let room = leaderGap + 1.5;
    for (const l of [c.lane - 1, c.lane + 1]) {
      if (!ok(l)) continue;
      let ahead = Infinity;
      for (const other of laneCars[laneKey(leg.seg, leg.fwd, l)]) { const o = slots[other]; if (o && o.p > c.p && o.p - c.p < ahead) ahead = o.p - c.p; }
      if (ahead > room) { room = ahead; target = l; }
    }
  }
  if (target < 0 || !gapIn(c, slot, target)) { c.lcCool = simTime + (mandatory ? 0.25 : 2); return; }
  c.chFrom = latOf(c, c.li, c.p);
  c.chP = c.p; c.chT = simTime; c.chLane = c.lane;
  c.lane = target; c.nextLane = -1;
  c.lcCool = simTime + (mandatory ? 0.4 : 3);
  const key = laneKey(leg.seg, leg.fwd, target);
  const list = laneJoin.get(key);
  if (list) list.push(slot); else laneJoin.set(key, [slot]);
}

// ---- junction boxes: several cars at once, when their paths do not cross ------------------------------
/**
 * The path a movement takes through a node, as the poses a car making it would actually occupy: along
 * its lane from the stop line, round the same corner curve the cars drive, and on into its lane on
 * the far side. Sampled finely enough that two bodies cannot slip between samples.
 */
function movementPath(inSeg: number, inFwd: boolean, inLane: number, outSeg: number, outFwd: boolean, outLane: number, _node: number): VehiclePose[] {
  const id = `${inSeg}:${+inFwd}:${inLane}>${outSeg}:${+outFwd}:${outLane}`;
  let path = movePaths.get(id);
  if (path) return path;
  const a: Leg = { seg: inSeg, fwd: inFwd, p0: 0, p1: segs[inSeg].len }, b: Leg = { seg: outSeg, fwd: outFwd, p0: 0, p1: segs[outSeg].len };
  const setback = approachSetback[inSeg * 2 + (inFwd ? 0 : 1)];
  const back = Math.min(a.p1 * 0.5, setback), on = Math.min(b.p1 * 0.5, setback);
  // A stand-in car on this movement, so the corner is drawn by the very code that moves real cars.
  const ghost = { legs: [a, b], li: 0, p: 0, vehicle: 1, lane: inLane, nextLane: outLane, prevLane: inLane, chT: -1, chFrom: 0, chP: 0 } as unknown as Car;
  path = [];
  const STEP = 0.12;
  for (let p = a.p1 - back; p < a.p1; p += STEP) { ghost.li = 0; path.push(vehiclePose(ghost, 0, p)); }
  ghost.prevLane = inLane; ghost.lane = outLane;
  for (let p = 0; p <= on; p += STEP) { ghost.li = 1; path.push(vehiclePose(ghost, 1, p)); }
  movePaths.set(id, path);
  return path;
}

/** The movement car `c` is about to make through the node at the end of its leg. */
function movementOf(c: Car, node: number): { inKey: number; path: VehiclePose[]; id: string } {
  const leg = c.legs[c.li], next = c.legs[c.li + 1];
  chooseNext(c);
  const path = movementPath(leg.seg, leg.fwd, c.lane, next.seg, next.fwd, c.nextLane, node);
  return { inKey: laneKey(leg.seg, leg.fwd, c.lane), path, id: `${laneKey(leg.seg, leg.fwd, c.lane)}>${laneKey(next.seg, next.fwd, c.nextLane)}` };
}

/** Whether two movements through a node cross or come too close. Two cars from the same lane just follow. */
function conflicts(m: ReturnType<typeof movementOf>, o: ReturnType<typeof movementOf>): boolean {
  if (m.inKey === o.inKey) return false;
  const id = m.id < o.id ? `${m.id}|${o.id}` : `${o.id}|${m.id}`;
  let hit = moveConflicts.get(id);
  if (hit === undefined) {
    // The bodies, a longest-vehicle's length and a little margin, overlap anywhere along the two paths.
    hit = false;
    for (const p of m.path) {
      for (const q of o.path) {
        if (Math.abs(p.x - q.x) > 0.9 || Math.abs(p.z - q.z) > 0.9) continue;
        if (vehiclesOverlap({ ...p, type: 3 }, { ...q, type: 3 }, 0.03)) { hit = true; break; }
      }
      if (hit) break;
    }
    moveConflicts.set(id, hit);
  }
  return hit;
}

/** The movement a car inside (or waiting for) a box is making, while it is still on the leg before it. */
function heldMovement(slot: number, node: number): ReturnType<typeof movementOf> | null {
  const o = slots[slot];
  if (!o) return null;
  // Inside the box and already over the node: its movement is the one from the leg it entered from.
  const li = o.box === node ? o.boxLi : o.li;
  const leg = o.legs[li], next = o.legs[li + 1];
  if (!leg || !next || legEndNode(leg) !== node) return null;
  const lane = li === o.li ? o.lane : o.prevLane, out = li === o.li ? (o.nextLane >= 0 ? o.nextLane : 0) : o.lane;
  return { inKey: laneKey(leg.seg, leg.fwd, lane), path: movementPath(leg.seg, leg.fwd, lane, next.seg, next.fwd, out, node), id: `${laneKey(leg.seg, leg.fwd, lane)}>${laneKey(next.seg, next.fwd, out)}` };
}

function leaveBox(slot: number): void {
  const c = slots[slot];
  if (!c || c.box < 0) return;
  const list = boxCars[c.box];
  const k = list ? list.indexOf(slot) : -1;
  if (k >= 0) list.splice(k, 1);
  c.box = -1;
}

/**
 * A circulating vehicle is about to reach this roundabout node, so an entering car must give way.
 * A car that has stopped on the arc is not about to arrive: it is queued for the box itself, and the
 * box is handed to circulating traffic first anyway. Treating it as oncoming made every arm wait out
 * RING_PATIENCE before it could ever enter, because a queued arc always has someone parked near a node.
 */
/** Free the node halves a car holds. */
function releaseLock(c: Car, slot: number): void {
  if (c.lock >= 0 && c.lock * 2 + 1 < lockOwner.length) for (let r = 0; r < 2; r++) if (lockOwner[c.lock * 2 + r] === slot) lockOwner[c.lock * 2 + r] = -1;
  c.lock = -1; c.lockMask = 0;
}

/**
 * The halves of a roundabout node (bit 0 outer, bit 1 inner) a car needs crossing it to its next leg:
 * the outer half to circulate in the outer lane or to join or leave by it, the inner half to circulate
 * in the inner lane, both to join or leave the inner lane (which crosses the outer).
 */
function ringMask(c: Car, node: number): number {
  const leg = c.legs[c.li], next = c.legs[c.li + 1];
  const ring = ringArc[leg.seg] ? leg : next && ringArc[next.seg] ? next : null;
  if (!ring || legLanes(ring) < 2 || legEndNode(leg) !== node) return 1;
  if (ringArc[leg.seg] && next && ringArc[next.seg]) return c.lane === 0 ? 1 : 2;
  const lane = ringArc[leg.seg] ? c.lane : ringLaneFor(c, c.li + 1);
  return lane === 0 ? 1 : 3;
}

/**
 * Whether circulating traffic is coming up to a roundabout node, so a car must wait to join: only the
 * outer lane's, for one joining the outer lane.
 */
function ringApproaching(node: number, outerOnly = false): boolean {
  for (const key of ringIn[node]) {
    if (outerOnly && key % MAXL !== 0) continue;
    const len = segs[dirKeyOf(key) >> 1].len;
    for (const slot of laneCars[key]) {
      const c = slots[slot];
      if (!c || c.stuck >= 0.5 || c.legs[c.li].seg !== dirKeyOf(key) >> 1) continue;
      // Judged by when it would get here, not how near it is: a fast car further off is as close.
      const leg = c.legs[c.li];
      if (leg.p1 < len - 0.05) continue; // it leaves the ring before this node
      if ((len - c.p) / Math.max(c.v, 0.3) < RING_TC || len - c.p < 0.4) return true;
    }
    // Cars that crossed into the arc during this step are not in its lane list yet.
    if (laneFresh[key] < 1e8 && laneFresh[key] > len - RING_GAP) return true;
  }
  return false;
}

// ---- traffic signals ------------------------------------------------------------------------------
/** The movement car `c` makes through `node`, in the key signal plans use. */
function moveKeyOf(c: Car, li = c.li): string {
  const leg = c.legs[li], next = c.legs[li + 1];
  return next ? moveKey(segs[leg.seg].id, leg.fwd, segs[next.seg].id, next.fwd) : '';
}

/** What the signal at `node` shows the car's movement right now. */
function signalFor(c: Car, node: number): SignalState {
  const plan = sigPlan[node];
  return plan ? stateIn(plan, sigPhase[node], sigT[node], sigLen[node], moveKeyOf(c)) : 'green';
}

/**
 * A car turning on a yield green gives way to traffic that has a protected green across its path
 * and is at, or nearly at, its own stop line.
 */
function yieldBlocked(c: Car, node: number): boolean {
  const mine = movementOf(c, node);
  const leg = c.legs[c.li];
  for (const a of sigApproaches[node]) {
    if (a.seg === leg.seg && a.fwd === leg.fwd) continue;
    const lanes = Math.max(1, dirLanes[a.seg * 2 + (a.fwd ? 0 : 1)]);
    for (let l = 0; l < lanes; l++) {
      let front: Car | null = null;
      for (const slot of laneCars[laneKey(a.seg, a.fwd, l)]) { const o = slots[slot]; if (o && (!front || o.p > front.p)) front = o; }
      if (!front || front.li >= front.legs.length - 1) continue;
      const fl = front.legs[front.li];
      if (fl.p1 - front.p > approachSetback[fl.seg * 2 + (fl.fwd ? 0 : 1)] + 2.5) continue;
      if (signalFor(front, node) !== 'green') continue;
      if (conflicts(mine, movementOf(front, node))) return true;
    }
  }
  return false;
}

/** Whether cars are waiting at, or coming up to, `node` for a movement that `phase` lets go. */
function signalDemand(node: number, phase: number): boolean {
  const plan = sigPlan[node]!, moves = plan.phases[phase].moves;
  for (const a of sigApproaches[node]) {
    const lanes = Math.max(1, dirLanes[a.seg * 2 + (a.fwd ? 0 : 1)]);
    for (let l = 0; l < lanes; l++) for (const slot of laneCars[laneKey(a.seg, a.fwd, l)]) {
      const o = slots[slot];
      if (!o || o.li >= o.legs.length - 1 || o.legs[o.li].p1 - o.p > 6) continue;
      if (moves[moveKeyOf(o)]) return true;
    }
  }
  return false;
}

/**
 * Run every signal's phase clock. A fixed signal gives each phase its green and then its amber. An
 * adaptive one also looks four times a second: after the shortest green it cuts a phase nobody is
 * using when someone waits for another, and it stretches a busy phase up to twice its set green.
 */
function stepSignals(dt: number): void {
  sigCheck += dt;
  const look = sigCheck >= 0.25;
  if (look) sigCheck = 0;
  for (let n = 0; n < sigPlan.length; n++) {
    const plan = sigPlan[n];
    if (!plan) continue;
    sigT[n] += dt;
    const green = plan.phases[sigPhase[n]].green;
    if (plan.adaptive && look && sigT[n] < sigLen[n]) {
      const here = signalDemand(n, sigPhase[n]);
      // Never cut a green short under people already crossing on it.
      if (sigT[n] >= MIN_GREEN && !here && !walkersOnCrossingsAt(n) && plan.phases.some((_, k) => k !== sigPhase[n] && signalDemand(n, k))) sigLen[n] = sigT[n];
      else if (here && sigLen[n] - sigT[n] < 0.5 && sigLen[n] < 2 * green) sigLen[n] = Math.min(2 * green, sigLen[n] + 0.5);
    }
    if (sigT[n] >= sigLen[n] + AMBER + ALL_RED) {
      sigT[n] -= sigLen[n] + AMBER + ALL_RED;
      sigPhase[n] = (sigPhase[n] + 1) % plan.phases.length;
      sigLen[n] = plan.phases[sigPhase[n]].green;
    }
  }
}

function stepCars(dt: number): void {
  for (const lane of laneCars) lane.length = 0;
  laneTail.fill(1e9);
  laneFresh.fill(1e9);
  laneJoin.clear();
  laneGhosts.clear();
  for (let s = 0; s < MAX_CARS; s++) {
    const c = slots[s];
    if (!c) continue;
    const leg = c.legs[c.li];
    const key = laneKey(leg.seg, leg.fwd, c.lane);
    laneCars[key].push(s);
    if (c.p < laneTail[key]) { laneTail[key] = c.p; laneTailV[key] = c.v; }
    if (c.chT >= 0 && c.chLane !== c.lane) {
      const from = laneKey(leg.seg, leg.fwd, c.chLane), list = laneGhosts.get(from);
      if (list) list.push(s); else laneGhosts.set(from, [s]);
    }
  }
  const speedSum = new Float32Array(segs.length);
  const speedN = new Uint16Array(segs.length);
  // Blue lights: junctions a callout is about to reach hold everyone else back, and the cars just
  // ahead of it in its lane make way.
  blueAt.fill(0); blueFrom.fill(-1);
  for (let s = 0; s < MAX_CARS; s++) {
    const m = slots[s];
    if (!m || !onCallout(m)) continue;
    const leg = m.legs[m.li];
    if (m.li < m.legs.length - 1) {
      const node = legEndNode(leg);
      if (nodeType[node] !== J_PLAIN && (leg.p1 - m.p) / Math.max(m.v, 0.5) < BLUE_WARNING) { blueAt[node] = 1; blueFrom[node] = leg.seg * 2 + (leg.fwd ? 0 : 1); }
    }
    if (m.box >= 0) blueAt[m.box] = 1;
    if (m.lock >= 0) blueAt[m.lock] = 1;
    // Coming the other way on a two-way road: while the callout is out passing, oncoming cars close
    // ahead of it pull over too; and it only goes out at all while the road ahead is clear of them.
    const seg = segs[leg.seg], along = leg.fwd ? m.p : seg.len - m.p;
    m.oncoming = false;
    // Only where passing crosses the centre line: from the innermost lane (on a road with more lanes
    // each way, one passes a car pulled over in the kerb lane within its own side of the road).
    if (!seg.oneway && m.lane >= legLanes(leg) - 1) for (let l = 0; l < Math.max(1, dirLanes[leg.seg * 2 + (leg.fwd ? 1 : 0)]); l++) for (const o of laneCars[laneKey(leg.seg, !leg.fwd, l)]) {
      const oc = slots[o];
      if (!oc || onCallout(oc)) continue;
      const theirs = leg.fwd ? seg.len - oc.p : oc.p, ahead = leg.fwd ? theirs - along : along - theirs;
      if (ahead < -0.5 || ahead > ONCOMING_CLEAR) continue;
      // Oncoming drivers pull over too, for a callout already out or waiting to get past: once they
      // have, there is room to pass between them.
      if (m.side < -0.05 || m.wantPass) { oc.yieldUntil = simTime + 0.5; oc.yieldTo = s; }
      if (oc.side < PULL_OVER * 0.8) m.oncoming = true;
    }
    // Ahead of it, and just passed by it: a car stays pulled over until the callout is a cell clear,
    // and the callout stays out until then too, or the two would slide back into each other.
    for (const o of laneCars[laneKey(leg.seg, leg.fwd, m.lane)]) {
      const oc = slots[o];
      if (!oc || o === s || onCallout(oc) || oc.p - m.p > MAKE_WAY || m.p - oc.p > 1) continue;
      if (oc.p <= m.p && !(oc.yieldUntil > simTime && oc.yieldTo === s)) continue;
      oc.yieldUntil = simTime + 0.5; oc.yieldTo = s;
      if (oc.p <= m.p + 0.5) m.yieldUntil = simTime + 0.5;
    }
  }

  for (let key = 0; key < laneCars.length; key++) {
    const lane = laneCars[key];
    if (!lane.length) continue;
    lane.sort((a, b) => slots[b]!.p - slots[a]!.p);
    let leaderP = Infinity, leaderLength = 0.34, leaderStuck = false, leaderV = 0, leaderSlot = -1;
    // The leader that is not pulled over for a callout: the one a callout itself follows.
    let firmP = Infinity, firmLength = 0.34, firmStuck = false, firmV = 0, firmSlot = -1;
    const playerP = playerLanes.get(dirKeyOf(key));
    // A bus in a lay-by signalling to pull out: the first driver behind who can stop in comfort holds
    // back for it, and those who cannot carry on past.
    let bayBus: { p: number; len: number; slot: number } | null = null;
    for (const slot of lane) {
      const c = slots[slot]!;
      // The player's car (or the player on foot) in this lane: traffic behind stops for it.
      if (playerP !== undefined && c.p < playerP - 0.02 && playerP < leaderP) { leaderP = playerP; leaderLength = 0.34; leaderV = 0; leaderSlot = -1; }
      if (bayBus && !onCallout(c) && c.p < bayBus.p) {
        const need = Math.max(GAP[segs[c.legs[c.li].seg].kind], (vehicleLength(c.vehicle) + bayBus.len) / 2 + 0.06);
        if (c.p + (c.v * c.v) / (2 * driverFor(c.vehicle).b) <= bayBus.p - need + 0.01) {
          leaderP = bayBus.p; leaderLength = bayBus.len; leaderV = 0; leaderStuck = true; leaderSlot = bayBus.slot;
          bayBus = null;
        }
      }
      const leg = c.legs[c.li];
      const seg = segs[leg.seg];
      const driver = driverFor(c.vehicle);
      // A callout passes cars that have pulled over for it: it follows the first one that has not.
      // (A callout marks itself with yieldUntil while it is beside a car that pulled over for it.)
      // It only pulls out to pass while the oncoming lane ahead is clear (or it is already out).
      const wantsPast = onCallout(c) && (firmP !== leaderP || c.yieldUntil > simTime);
      c.wantPass = wantsPast;
      const passing = wantsPast && (!c.oncoming || c.side < -0.05);
      if (passing) { leaderP = firmP; leaderLength = firmLength; leaderStuck = firmStuck; leaderV = firmV; leaderSlot = firmSlot; }
      const yielding = !onCallout(c) && c.yieldUntil > simTime && onCallout(slots[c.yieldTo]);
      // On one lane, or in the kerb lane of several, it pulls over; in another lane it moves across.
      const pullingOver = yielding && (legLanes(leg) < 2 || c.lane === 0);
      // A bus drawing up at a stop: into the lay-by if it has one, or a nudge to the kerb.
      const call = c.calls?.[c.callIdx ?? 0];
      const atStop = !!call && call.li === c.li;
      const stopP = atStop ? call!.p : Infinity;
      // (Only from the kerb lane: a bus that could not get over stands where it is.)
      const kerbward = c.lane === 0 || legLanes(leg) < 2;
      const kerbGoal = atStop && stopP - c.p < 1.2 && kerbward ? (call!.bay ? BAY_SIDE : 0.08) : 0;
      // Easing towards the kerb to make way, out to pass one that has, or back to the lane's centre.
      c.sideGoal = pullingOver ? PULL_OVER : passing ? -PASS_OUT : kerbGoal;
      const sideBefore = c.side;
      c.side += Math.max(-0.4 * dt, Math.min(0.4 * dt, c.sideGoal - c.side));
      const gap = Math.max(GAP[seg.kind], (vehicleLength(c.vehicle) + leaderLength) / 2 + 0.06);
      c.time += dt;
      if (c.crash !== undefined && incidents.crashes.has(c.crash)) {
        c.v = 0; leaderP = firmP = c.p; leaderLength = firmLength = vehicleLength(c.vehicle); leaderStuck = firmStuck = true; leaderV = firmV = 0; firmSlot = slot; speedN[leg.seg]++; continue;
      }
      c.crash = undefined;
      if (c.working && c.mission) {
        c.mission.work -= dt;
        if (c.mission.work <= 0) {
          if (c.mission.kind === 'fire') incidents.extinguish(c.mission.tile);
          else if (c.mission.kind === 'heist') incidents.foil(c.mission.tile);
          else if (c.mission.kind === 'patrol') incidents.visit(c.mission.tile);
          else if (c.mission.kind === 'garbage') collectGarbage(c.mission.tile);
          else if (c.mission.crash !== undefined) incidents.crashes.delete(c.mission.crash);
          freeCar(slot);
        } else { c.v = 0; leaderP = firmP = c.p; leaderLength = firmLength = vehicleLength(c.vehicle); leaderStuck = firmStuck = true; leaderV = firmV = 0; firmSlot = slot; }
        continue;
      }

      // Release a junction lock, or leave the box, once clear of it. On a roundabout arc that is as soon
      // as the tail is past the node: a car queued on the arc stops short of the usual release point,
      // and a full ring of cars each still holding the node behind them waits on itself for ever.
      const clearOf = ringArc[leg.seg] ? Math.min(0.8, seg.len * 0.5, leg.p0 + vehicleLength(c.vehicle) / 2 + 0.12) : Math.min(0.8, seg.len * 0.5);
      if (c.lock >= 0 && c.li > c.lockLi && c.p > clearOf) releaseLock(c, slot);
      // Out of the box once its tail is clear of the junction: on a wide one that is further than 0.8.
      if (c.box >= 0 && c.li > c.boxLi && c.p > Math.min(Math.max(0.8, nodeHalf[c.box] + vehicleLength(c.vehicle) / 2 + 0.1), seg.len * 0.5)) leaveBox(slot);
      // A finished lane change; one that has been stuck for a while goes back to where it was.
      if (c.chT >= 0) {
        if (Math.max((c.p - c.chP) / LC_DIST, (simTime - c.chT) / LC_TIME) >= 1) c.chT = -1;
        else if (c.stuck > 3 && c.box < 0) { c.chFrom = latOf(c, c.li, c.p); c.chP = c.p; c.chT = simTime; c.lane = c.chLane; c.nextLane = -1; c.lcCool = simTime + 2; }
      }
      // A bus at its stop: pull in (into the lay-by, if there is one), stand there, then carry on once
      // it can pull back out without making anyone brake hard.
      let standing = false;
      if (atStop && c.p >= stopP - 0.03) {
        standing = true;
        if (!c.dwellUntil) c.dwellUntil = simTime + (call!.far ? BUS_DWELL : CALL_DWELL);
        else if (c.dwellUntil <= simTime && (!c.inBay || canLeaveBay(c, slot)) && (!uTurnAfter(c) || canUTurn(c))) {
          c.callIdx = (c.callIdx ?? 0) + 1; c.dwellUntil = 0; standing = false;
          if (call!.bay) c.leavingBay = true;
        }
      }
      if (c.leavingBay && c.side < 0.02) c.leavingBay = false;
      // All the way into the bay, it is out of the traffic lane: those behind pass it.
      c.inBay = atStop && call!.bay && (c.lane === 0 || legLanes(leg) < 2) && c.side > BAY_SIDE * 0.95;
      // Standing at the stop is not being stuck; waiting to pull out again is.
      if (c.inBay && (c.dwellUntil ?? 0) > simTime) c.stuck = 0;
      // Pulled over for a callout, it comes to a stop at the kerb until it has passed.
      const vWant = pullingOver || standing ? 0 : atStop ? Math.min(desiredSpeed(c), approachSpeed(0.2, stopP - c.p, driver.b)) : desiredSpeed(c);
      considerLaneChange(c, slot, leaderP - c.p, leaderStuck || (leaderP - c.p < 1.5 && leaderV < 0.6 * vWant));

      const leaderHold = leaderP - gap;
      let maxP = atStop ? Math.min(leaderHold, stopP) : leaderHold;
      // What the driver reacts to: the hard limits, less a junction it has not yet asked for.
      let idmMax = atStop ? Math.min(leaderHold, stopP) : leaderHold;
      // The car it follows when nothing on its own leg is ahead: the back of the queue in the lane it
      // will take beyond the junction, so it eases off for a queue there instead of meeting it at the node.
      let aheadRoom = Infinity, aheadV = 0;
      const final = c.li === c.legs.length - 1;
      // A leg normally runs the whole link, but a roundabout arc is entered and left where the arm's
      // lane meets it rather than at the node, so the leg's own bounds are what count.
      const legEnd = leg.p1;
      if (final) {
        maxP = Math.min(maxP, leg.p1); // arriving cars pull off the road, so ignore the gap
      } else {
        const node = leg.fwd ? segB[leg.seg] : segA[leg.seg];
        // A car waiting at a junction must stand clear of the corridor it is about to cross, so the
        // setback scales with the widest road at the node. On a roundabout arc the car is already inside
        // the ring corridor and only has to keep its own distance, so it keeps the plain setback.
        const setback = ringArc[leg.seg] ? STOP_SETBACK : approachSetback[leg.seg * 2 + (leg.fwd ? 0 : 1)];
        const span = legEnd - leg.p0;
        const stopP = span > Math.max(1.8, setback * 2) ? legEnd - setback : leg.p0 + span * 0.5;
        const pastStop = c.p > stopP + 1e-3;
        // A car asks for the junction once it is within braking distance of the line, so traffic that
        // may go rolls straight through rather than stopping at every line to ask.
        const reach = Math.max(0.3, (c.v * c.v) / (2 * driver.b) + c.v * driver.T + 0.3);
        // Not yet close enough to ask: the line is no reason to slow down yet.
        let pending = false;
        const next = c.legs[c.li + 1];
        chooseNext(c);
        const nextKey = laneKey(next.seg, next.fwd, c.nextLane);
        // Room on the far side, in the lane it will take, measured from where this car will actually land:
        // enough to stand behind the longest vehicle that could already be there.
        const clear = Math.max(GAP[segs[next.seg].kind], (vehicleLength(c.vehicle) + vehicleLength(3)) / 2 + 0.06);
        // Don't block the box: go only if there is room to get the whole car out past the junction,
        // not just its nose, or it stops across the crossing traffic's path and locks the junction.
        const span1 = next.p1 - next.p0;
        const out = Math.min(0.8, segs[next.seg].len * 0.5) + vehicleLength(c.vehicle) / 2 + 0.1;
        // A car on the far side that is moving will make the room: only a standing queue there needs it
        // already clear, or a car following it in would stop across the box.
        const flowing = laneTailV[nextKey] > 0.5;
        // Behind a moving car, the room it will have made by the time this one gets there counts: judged
        // by how fast it is really going, so a queue crawling out of the box does not draw more cars in.
        // Joining a roundabout needs the room there now: the arm's lane meets the ring part-way along
        // the arc, so a car let in on room still to come ends up alongside the one it follows, locked.
        const joiningRing = nodeType[node] === J_RING && !ringArc[leg.seg];
        const lead = flowing && !joiningRing ? Math.min(legEnd - c.p, laneTailV[nextKey] * (legEnd - c.p) / Math.max(c.v, 0.5)) : 0;
        let canGo = laneTail[nextKey] - next.p0 + lead > Math.min(Math.max(clear, nodeType[node] === J_PLAIN || nodeType[node] === J_RING || flowing ? 0 : out), span1 * 0.9);
        const type = nodeType[node];
        // Blue lights: a callout goes through on red, and everyone else waits for it.
        // Only a callout under blue lights goes through on red: a patrol or a bin lorry waits like anyone.
        if (type === J_LIGHT && !pastStop && !onCallout(c)) {
          const st = signalFor(c, node);
          // A turner that has waited at the line on its yield green goes at the end of it, once the
          // oncoming traffic has stopped for the amber, as drivers do; otherwise a busy oncoming
          // stream would keep it, and everyone behind it, there for ever.
          const clearing = st === 'amber' && sigPlan[node]!.phases[sigPhase[node]].moves[moveKeyOf(c)] === 2 && c.p >= stopP - 0.3;
          // Amber: stop if you can. Only a car already rolling up to the line carries on.
          // Amber: stop if it can stop comfortably before the line. Too close for that, it carries on.
          if (st === 'red' || (st === 'amber' && !clearing && (c.stuck > 0 || stopP - c.p >= (c.v * c.v) / (2 * driver.b)))) canGo = false;
          else if ((st === 'yield' || clearing) && yieldBlocked(c, node)) canGo = false;
        }
        // An all-way stop: come to a halt at the line, then take your turn like any other junction.
        if (type === J_STOP && !pastStop && c.stopAt !== node) {
          if (c.p >= stopP - 0.25 && c.stuck >= STOP_WAIT) c.stopAt = node;
          else canGo = false;
        }
        // In a lane that does not go its way: hold at the line a while for a chance to move over.
        // Seen from braking distance, so the car slows for it rather than stopping dead at the line.
        if (type !== J_PLAIN && type !== J_RING && !pastStop && c.p >= stopP - reach) {
          const want = wantedLanes(c);
          // Fire engines, patrols and other callouts take the turn from whatever lane they are in.
          if (want && !want.includes(c.lane) && c.laneWait < 8 && !c.mission) { if (c.p >= stopP - 0.3) c.laneWait += dt; canGo = false; }
          // Finish sliding into a lane before turning out of it.
          if (c.chT >= 0) canGo = false;
        }
        // Let in early from a few cells out, then stopped short of the line after all (the light changed,
        // the exit filled up): it gives its place in the box back, or it blocks the crossing traffic
        // it is no longer going to get in front of.
        if (!canGo && c.box === node && c.boxLi === c.li && !pastStop) leaveBox(slot);
        // Let in early, and still short of its line: if a car already past its own line is now crossing
        // its path (it went ahead in the gap this one left), this one gives its place back and waits.
        if (canGo && c.box === node && c.boxLi === c.li && !pastStop && committedConflict(c, slot, node)) { leaveBox(slot); canGo = false; }
        // Roundabout priority: circulating traffic goes first, so a car joining the ring waits while
        // any vehicle is on the arc feeding this node. Filling the ring from the arms is what gridlocked it.
        const entering = type === J_RING && !ringArc[leg.seg];
        if (type === J_RING) {
          // A busy circle never leaves the box free, so give-way alone starved the arms completely. Once a
          // driver has waited out its patience it books the box: circulating traffic queues behind that
          // booking until the car is in, which keeps the merge serialised instead of forcing it.
          const booked = ringClaim[node] >= 0 ? slots[ringClaim[node]] : null;
          const bl = booked?.legs[booked.li];
          if (ringClaim[node] >= 0 && (!bl || ringArc[bl.seg] || legEndNode(bl) !== node)) ringClaim[node] = -1;
          // A car that pulled out of a lot, or changed lanes, ahead of the one holding the booking leaves
          // it stuck behind them for ever, and the booking with it: the front car takes the turn over.
          else if (entering && booked && bl && leaderP === Infinity && ringClaim[node] !== slot && bl.seg === leg.seg && bl.fwd === leg.fwd && booked.p < c.p) ringClaim[node] = slot;
          if (entering && leaderP === Infinity && c.stuck >= RING_PATIENCE && ringClaim[node] < 0) ringClaim[node] = slot;
          if (ringClaim[node] === slot && !canGo) ringRoomless[node] = simTime;
        }
        if (entering && c.lock !== node && c.stuck < RING_PATIENCE && ringApproaching(node, ringLaneFor(c, c.li + 1) === 0)) canGo = false;
        // Blue lights coming: nobody else goes into the junction.
        if (blueAt[node] && !onCallout(c) && c.lock !== node && c.box !== node && blueFrom[node] !== leg.seg * 2 + (leg.fwd ? 0 : 1)) canGo = false;
        if (type === J_RING && c.lock !== node) {
          const front = leaderP === Infinity;
          // Which halves of the node it crosses: on a two-lane ring, circulating in the outer lane and in
          // the inner one go side by side, but getting to or from the inner lane crosses the outer.
          const mask = ringMask(c, node);
          for (let r = 0; r < 2; r++) {
            if (!(mask & (1 << r))) continue;
            const owner = lockOwner[node * 2 + r];
            const holder = owner >= 0 && owner !== slot ? slots[owner] : null;
            if (owner >= 0 && (!holder || holder.lock !== node)) { lockOwner[node * 2 + r] = -1; continue; }
            if (!holder) continue;
            const hLeg = holder.legs[holder.li];
            // Only the front car of a lane may claim the box. A follower holding it (a car spawned or merged
            // in ahead of it after it claimed) would wait on its own leader forever, so the front car takes it over.
            const stale = front && hLeg.seg === leg.seg && hLeg.fwd === leg.fwd && holder.lane === c.lane && holder.p < c.p;
            // Circulating traffic owns the circle. A car queued on an arm may claim the box before it can
            // actually merge, and then it holds up the very ring traffic it is waiting for a gap in, so a
            // car already on the ring takes the box back off anyone still waiting outside it.
            const yielding = ringArc[leg.seg] && !ringArc[hLeg.seg] && owner !== ringClaim[node] && holder.p <= holder.lockStop + 1e-3;
            // Circulating right behind a car already past the node: it takes the lock over, so ring
            // traffic flows as a stream instead of stopping at every node for the car ahead to clear it.
            // The lock stays with circulating traffic, so no one pulls out in between.
            const through = ringArc[leg.seg] && holder.li > holder.lockLi && front;
            if (stale || yielding || through) releaseLock(holder, owner);
          }
          // A booking holds back traffic going on round the circle. Traffic leaving it here only makes room,
          // so while the booker is itself waiting for room on the ring it goes: held behind that booking it
          // would lock the ring. Otherwise it waits its turn too, so a stream leaving cannot starve the arm.
          // (Insistence stops at a roundabout: forcing onto a full ring is what locks it solid.)
          const booked = ringClaim[node] >= 0 && ringClaim[node] !== slot && (!!ringArc[next.seg] || ringRoomless[node] < simTime - 0.25);
          if (canGo && front && !booked && c.p < stopP - reach) {
            pending = true;
            canGo = false;
          } else if (canGo && front && !booked && !(mask & 1 && lockOwner[node * 2] >= 0) && !(mask & 2 && lockOwner[node * 2 + 1] >= 0)) {
            // Hand over rather than overwrite: on short links (roundabout arcs) the next box is claimed
            // before the previous one is released, and overwriting leaked that lock forever.
            releaseLock(c, slot);
            c.lock = node;
            c.lockLi = c.li;
            c.lockStop = stopP;
            c.lockMask = mask;
            if (mask & 1) lockOwner[node * 2] = slot;
            if (mask & 2) lockOwner[node * 2 + 1] = slot;
            if (ringClaim[node] === slot) ringClaim[node] = -1;
          } else {
            canGo = false;
          }
        } else if (type !== J_PLAIN && type !== J_RING && c.box !== node) {
          // Any number of cars may be in the box at once, as long as their paths through it do not cross.
          const front = leaderP === Infinity;
          // Right behind a car already let into the box on the same path, a car follows it in: a queue
          // pulls away as a platoon, not one standing start at a time.
          const ahead = leaderSlot >= 0 ? slots[leaderSlot] : null;
          const platoon = !front && !!ahead && ahead.box === node && ahead.boxLi === ahead.li && ahead.legs[ahead.li].seg === leg.seg && ahead.legs[ahead.li].fwd === leg.fwd && ahead.lane === c.lane && ahead.nextLane === c.nextLane && ahead.legs[ahead.li + 1]?.seg === next.seg && ahead.legs[ahead.li + 1]?.fwd === next.fwd;
          const atLine = (front || platoon) && c.p >= stopP - reach;
          const list = boxCars[node];
          for (let k = list.length - 1; k >= 0; k--) { const o = slots[list[k]]; if (!o || o.box !== node) list.splice(k, 1); }
          // A booking only stands while the car that made it is still being held by crossing traffic
          // alone. Held up by a full exit, a red light or its own lane change, it would only block others.
          const waiting = boxWait[node], w = waiting >= 0 ? slots[waiting] : null;
          if (waiting >= 0 && waiting !== slot && (!w || w.box === node || legEndNode(w.legs[w.li]) !== node || w.boxBlockedAt < simTime - 0.2)) boxWait[node] = -1;
          if (canGo && atLine) {
            const mine = movementOf(c, node);
            let blocked = false;
            // A car let in early, still well short of the junction at speed, is judged by when it will
            // get there: going first is fine if it is further off than the gap this car needs.
            const need = boxGapFor(c, node);
            for (const other of list) {
              const m = heldMovement(other, node);
              if (!m || !conflicts(mine, m)) continue;
              const o = slots[other]!;
              if (o.boxLi === o.li && o.v >= 1 && (o.legs[o.li].p1 - o.p) / o.v >= need) continue;
              blocked = true; break;
            }
            // Priority: off the major road, wait for a gap in it; a booking made after long patience forces the way in.
            if (!blocked && nodePriority[node] && boxWait[node] !== slot && !c.insistent && priorityBlocked(c, node, mine)) blocked = true;
            // People on a crossing it would pass over: it waits for them, whoever has priority.
            if (!blocked && walkersBlock(c, node)) blocked = true;
            // Whoever has waited longest has booked the box: nothing that would cut across it goes first.
            if (!blocked && boxWait[node] >= 0 && boxWait[node] !== slot && !c.insistent) { const m = heldMovement(boxWait[node], node); if (m && conflicts(mine, m)) blocked = true; }
            if (!blocked) {
              c.box = node; c.boxLi = c.li; list.push(slot);
              if (type === J_LIGHT) { const st = onCallout(c) ? 'callout' : signalFor(c, node); sigAdmits[st] = (sigAdmits[st] ?? 0) + 1; }
              if (boxWait[node] === slot) boxWait[node] = -1;
            } else {
              canGo = false;
              c.boxBlockedAt = simTime;
              // Held by crossing traffic alone: book the box once it has waited a while (a callout
              // almost at once), so a busy stream cannot starve it.
              // Off the major road it waits far longer first: priority is real, but no arm starves.
              if (c.stuck > (onCallout(c) ? 1 : nodePriority[node] && !onMajor(c) ? MINOR_PATIENCE : 4) && boxWait[node] < 0) boxWait[node] = slot;
            }
          } else {
            // Waiting on the car in front, or not yet near enough to ask: that car or nothing is what
            // it drives by, and the line only stops it if it ever gets there.
            if (canGo && !pastStop && (front || platoon)) pending = true;
            canGo = false;
            if (boxWait[node] === slot) boxWait[node] = -1;
          }
        }
        if (!canGo) {
          const hold = pastStop ? legEnd - 0.02 : stopP;
          maxP = Math.min(maxP, hold);
          if (!pending) idmMax = Math.min(idmMax, hold);
        }
        // Not yet asked for the junction counts as going: it will, and must slow in time for that queue.
        if ((canGo || pending) && leaderP === Infinity && laneTail[nextKey] < 1e8) {
          // Round a corner, bodies swing wider than the distance along the path suggests.
          const corner = turnKind(leg, next) === 0 ? 0 : 0.15;
          aheadRoom = legEnd - c.p + (laneTail[nextKey] - next.p0) - clear - corner;
          aheadV = laneTailV[nextKey];
        }
      }

      // Bodies the lane order does not show: a car sliding out of this lane still half in it, and the
      // car that last left this lane, still crossing the junction whichever way it went.
      const myKey = laneKey(leg.seg, leg.fwd, c.lane), myLen = vehicleLength(c.vehicle);
      const bodyGap = (o: Car): number => Math.max(GAP[seg.kind], (myLen + vehicleLength(o.vehicle)) / 2 + 0.06);
      for (const g of laneGhosts.get(myKey) ?? []) {
        const o = slots[g];
        if (!o || o.p <= c.p) continue;
        const r = o.p - c.p - bodyGap(o);
        if (r < aheadRoom) { aheadRoom = r; aheadV = o.v; }
      }
      if (leaderP === Infinity && laneLeft[myKey] >= 0) {
        const o = slots[laneLeft[myKey]];
        const prev = o && o.li > 0 ? o.legs[o.li - 1] : null;
        if (o && prev && prev.seg === leg.seg && prev.fwd === leg.fwd && o.p - o.legs[o.li].p0 < 1.5) {
          // One turning round in the road is still where it turned, until it has swung clear.
          const r = isUTurn(prev, o.legs[o.li]) ? prev.p1 - c.p - bodyGap(o) : legEnd - c.p + (o.p - o.legs[o.li].p0) - bodyGap(o);
          if (r < aheadRoom) { aheadRoom = r; aheadV = o.v; }
        } else laneLeft[myKey] = -1;
      }
      // Drive: IDM towards the nearest thing ahead, never past the hard limit.
      const room = Math.min(idmMax - c.p, aheadRoom);
      const followingLeader = idmMax >= leaderHold - 1e-6 && room === idmMax - c.p;
      const obstacleV = room === aheadRoom ? aheadV : followingLeader ? leaderV : 0;
      const accel = idmAccel(c.v, vWant, room, c.v - obstacleV, driver);
      const motion = stepMotion(c.p, c.v, accel, dt, maxP, Math.max(vWant, c.v));
      const travel = motion.p;
      let newP = Math.min(travel, legEnd);
      if (newP < c.p) newP = c.p;
      const target = vehiclePose(c, c.li, newP);
      // Held up mid lane change, a car still finishes sliding across where it stands, rather than
      // straddling two lanes and blocking both.
      if (c.chT >= 0 && newP > c.p && !trafficSpace.canMove(slot, target)) {
        const aside = vehiclePose(c, c.li, c.p);
        if (trafficSpace.canMove(slot, aside)) trafficSpace.set(slot, aside);
      }
      // Refused: it stays where it was, sideways too, so what is drawn is what is checked.
      if (!trafficSpace.canMove(slot, target)) { newP = c.p; c.side = sideBefore; }
      else trafficSpace.set(slot, target);
      const moved = newP - c.p;
      // Stopped short by something the model did not see (another car's body): it has that speed only.
      const vBefore = c.v;
      c.v = newP < travel - 1e-6 && newP < legEnd - 1e-6 ? moved / dt : motion.v;
      c.accel = (c.v - vBefore) / dt;
      if (c.accel < -0.4 || c.v < 0.05) c.brakeT = simTime;
      speedSum[leg.seg] += Math.min(1, moved / (Math.max(vWant, 0.3) * dt));
      speedN[leg.seg]++;
      // Standing still, or edging forward a hair at a time, counts as waiting: creeping must not
      // reset a driver's patience at a junction.
      if (moved < 2e-3) c.stuck += dt; else c.stuck = 0;
      if (c.v < 0.3 && (c.li > 0 || c.p > leg.p0 + 0.3)) c.stood += dt;
      c.p = newP;
      // A bus in a lay-by is nobody's leader: the car behind follows the one ahead of it (unless it
      // lets the bus out).
      if (!c.inBay) {
        leaderP = newP; leaderLength = vehicleLength(c.vehicle); leaderStuck = c.stuck > 0.3; leaderV = c.v; leaderSlot = slot;
        if (!pullingOver) { firmP = newP; firmLength = leaderLength; firmStuck = leaderStuck; firmV = c.v; firmSlot = slot; }
      } else if ((c.dwellUntil ?? 0) > 0 && c.dwellUntil! <= simTime) bayBus = { p: newP, len: vehicleLength(c.vehicle), slot };

      if (final) {
        if (c.p >= leg.p1 - 1e-3) {
          if (c.mission) { c.working = true; c.mission.work = c.mission.kind === 'fire' ? 8 : 4; }
          else {
            if (c.taxiStop !== undefined) { taxiWindow++; money += 0.16 * effects.fare; }
            if (!c.through) commuteAvg = commuteAvg === 0 ? c.time : commuteAvg * 0.97 + c.time * 0.03;
            countLeft(c);
            arrivedTotal++;
            const trip = `${segs[c.legs[0].seg].id}>${segs[leg.seg].id}`;
            arrivedBy.set(trip, (arrivedBy.get(trip) ?? 0) + 1);
            freeCar(slot); leaderP = Infinity; leaderSlot = -1; }
        }
      } else if (c.p >= legEnd - 1e-4 && !atStop) {
        // Carry the unused travel into the next link, in the lane chosen for it. Polyline links meet
        // with a small kink, so the exact start of the next link can sit a hair behind and to the side
        // of where this one ended; on a roundabout the follower is close enough that this one pose was
        // blocked, and the leader then waited on the car waiting behind it forever.
        const next = c.legs[c.li + 1];
        chooseNext(c);
        const nextKey = laneKey(next.seg, next.fwd, c.nextLane);
        const nextSeg = segs[next.seg];
        const carry = Math.max(0, Math.min(travel - legEnd, laneTail[nextKey] - next.p0 - GAP[nextSeg.kind], next.p1 - next.p0));
        for (const nextP of carry > 1e-3 ? [next.p0 + carry, next.p0] : [next.p0]) {
          const target = vehiclePose(c, c.li + 1, nextP);
          if (!trafficSpace.canMove(slot, target)) continue;
          const delayed = c.stood;
          countLeft(c);
          laneLeft[laneKey(leg.seg, leg.fwd, c.lane)] = slot;
          c.li++;
          c.p = nextP;
          c.stuck = 0;
          c.prevLane = c.lane; c.lane = c.nextLane; c.nextLane = -1; c.chT = -1; c.laneWait = 0; c.side = 0;
          trafficSpace.set(slot, target);
          if (c.p < laneTail[nextKey]) { laneTail[nextKey] = c.p; laneTailV[nextKey] = c.v; }
          if (c.p < laneFresh[nextKey]) laneFresh[nextKey] = c.p;
          leaderP = Infinity; leaderStuck = false; leaderSlot = -1;
          // Not for a wait at a red light (it would clear anyway), nor more than once in a while.
          const passedLight = nodeType[legEndNode(leg)] === J_LIGHT;
          if (delayed > REROUTE_DELAY && !passedLight && !c.loop && !c.mission && c.line === undefined && c.vehicle !== 8 && simTime - (c.rerouteAt ?? -99) > 15) reroute(c);
          break;
        }
      }
      // Waiting out a long red is not being stuck: at a signal, a whole cycle's wait is allowed first.
      const endNode = c.li < c.legs.length - 1 ? legEndNode(c.legs[c.li]) : -1;
      const patience = 30 + (endNode >= 0 && sigPlan[endNode] ? cycleOf(sigPlan[endNode]!) * (sigPlan[endNode]!.adaptive ? 2 : 1) : 0);
      c.insistent = c.stuck > patience * INSIST_SHARE;
      if (slots[slot] && c.stuck > patience) {
        gaveUp++; gaveUpTotal++;
        commuteAvg = commuteAvg * 0.97 + 90 * 0.03;
        freeCar(slot);
      }
    }
  }
  for (let i = 0; i < segs.length; i++) {
    const target = speedN[i] ? 1 - speedSum[i] / speedN[i] : 0;
    segCong[i] += (target - segCong[i]) * (speedN[i] ? 0.04 : 0.02);
  }
}

/** The speed a car may take the node between two legs at: the tighter the turn, the slower. */
function turnSpeed(leg: Leg, next: Leg): number {
  const key = ((leg.seg * 2 + (leg.fwd ? 1 : 0)) * segs.length + next.seg) * 2 + (next.fwd ? 1 : 0);
  let v = turnV.get(key);
  if (v === undefined) {
    const pose = { x: 0, z: 0, tx: 0, tz: 0 };
    const a = segs[leg.seg], b = segs[next.seg];
    Network.poseAt(a, leg.fwd ? a.len : 0, pose);
    const ax = leg.fwd ? pose.tx : -pose.tx, az = leg.fwd ? pose.tz : -pose.tz;
    Network.poseAt(b, next.fwd ? 0 : b.len, pose);
    const bx = next.fwd ? pose.tx : -pose.tx, bz = next.fwd ? pose.tz : -pose.tz;
    const theta = Math.acos(Math.max(-1, Math.min(1, ax * bx + az * bz)));
    v = curveSpeed(turnRadius(theta, CORNER));
    turnV.set(key, v);
  }
  return v;
}

/** Which way a car turns between two legs: 0 straight on, 1 right, 2 left. */
function turnKind(leg: Leg, next: Leg): number {
  const key = ((leg.seg * 2 + (leg.fwd ? 1 : 0)) * segs.length + next.seg) * 2 + (next.fwd ? 1 : 0);
  let k = turnK.get(key);
  if (k === undefined) {
    const pose = { x: 0, z: 0, tx: 0, tz: 0 };
    const a = segs[leg.seg], b = segs[next.seg];
    Network.poseAt(a, leg.fwd ? a.len : 0, pose);
    const ax = leg.fwd ? pose.tx : -pose.tx, az = leg.fwd ? pose.tz : -pose.tz;
    Network.poseAt(b, next.fwd ? 0 : b.len, pose);
    const t = turnOf(ax, az, next.fwd ? pose.tx : -pose.tx, next.fwd ? pose.tz : -pose.tz);
    k = t === 'straight' ? 0 : t === 'right' ? 1 : 2;
    turnK.set(key, k);
  }
  return k;
}

/** Whether car `c` arrives on the major road of a junction with priority. */
const onMajor = (c: Car): boolean => { const leg = c.legs[c.li]; return majorIn[leg.seg * 2 + (leg.fwd ? 0 : 1)] === 1; };

/**
 * At a junction where one road has priority, whether car `c` must still give way: some car on the
 * major road that would cross its path could reach the junction within the gap `c` needs. A car that
 * has stopped short of the junction is not arriving; if it moves off, the box sorts out who goes.
 */
function priorityBlocked(c: Car, node: number, mine: ReturnType<typeof movementOf>): boolean {
  const leg = c.legs[c.li], next = c.legs[c.li + 1];
  const k = turnKind(leg, next);
  const tc = criticalGap(k === 0 ? 'straight' : k === 1 ? 'right' : 'left', onMajor(c));
  if (tc <= 0) return false;
  for (const a of nodeIn[node]) {
    if (!majorIn[a.seg * 2 + (a.fwd ? 0 : 1)] || (a.seg === leg.seg && a.fwd === leg.fwd)) continue;
    const lanes = Math.max(1, dirLanes[a.seg * 2 + (a.fwd ? 0 : 1)]);
    for (let l = 0; l < lanes; l++) for (const slot of laneCars[laneKey(a.seg, a.fwd, l)]) {
      const o = slots[slot];
      if (!o || o.box === node || o.v < 0.3 || o.li >= o.legs.length - 1) continue;
      const ol = o.legs[o.li];
      if (legEndNode(ol) !== node) continue;
      if ((ol.p1 - o.p) / Math.max(o.v, 0.5) >= tc) continue;
      if (conflicts(mine, movementOf(o, node))) return true;
    }
  }
  return false;
}

/**
 * The time a car needs clear of crossing traffic to go through a junction: its critical gap off the
 * major road, a short safety margin otherwise.
 */
function boxGapFor(c: Car, node: number): number {
  if (!nodePriority[node]) return BOX_GAP;
  const k = turnKind(c.legs[c.li], c.legs[c.li + 1]);
  return Math.max(BOX_GAP, criticalGap(k === 0 ? 'straight' : k === 1 ? 'right' : 'left', onMajor(c)));
}
const BOX_GAP = 1.6;

/** Whether a car in the box that is already past its stop line (or on its way out) is making a movement that crosses `c`'s. */
function committedConflict(c: Car, slot: number, node: number): boolean {
  const mine = movementOf(c, node);
  for (const other of boxCars[node] ?? []) {
    if (other === slot) continue;
    const o = slots[other];
    if (!o || o.box !== node) continue;
    const ol = o.legs[o.li];
    const past = o.li > o.boxLi || ol.p1 - o.p < approachSetback[ol.seg * 2 + (ol.fwd ? 0 : 1)] - 0.05;
    if (!past) continue;
    const m = heldMovement(other, node);
    if (m && conflicts(mine, m)) return true;
  }
  return false;
}

/** How fast a car turns off the road at the end of its trip. */
const ARRIVE_SPEED = 0.8;
/** How much each driver's judgement of a road's time varies, as a share of it. */
const ROUTE_JITTER = 0.3;
/** Held up this long on a road, a driver looks again for a better way from the next junction. */
const REROUTE_DELAY = 6;
/** How long a bus stands at its far stop. */
const BUS_DWELL = 3;

/**
 * Whether a bus standing in a lay-by may pull back out: nobody alongside it, and every car coming up
 * behind it in the lane can stop in comfort short of it (drivers let a signalling bus out).
 */
function canLeaveBay(c: Car, slot: number): boolean {
  const leg = c.legs[c.li], len = vehicleLength(c.vehicle);
  for (const o of laneCars[laneKey(leg.seg, leg.fwd, c.lane)]) {
    const oc = slots[o];
    if (!oc || o === slot || oc.inBay) continue;
    const ol = oc.legs[oc.li];
    if (ol.seg !== leg.seg || ol.fwd !== leg.fwd) continue;
    const half = (len + vehicleLength(oc.vehicle)) / 2, d = c.p - oc.p;
    if (d < -half - 0.05) continue; // well ahead of it
    if (d < half + 0.04) return false; // beside it (one holding back to let it out stops further back)
    // Room for it to stop behind the bus as it would behind any car (see the lane loop's bayBus).
    const need = Math.max(GAP[segs[leg.seg].kind], half + 0.06);
    if (oc.p + (oc.v * oc.v) / (2 * driverFor(oc.vehicle).b) > c.p - need + 0.02) return false;
  }
  return true;
}

/** What a stretch of route costs a driver now, as the route search counts it. */
function legsCost(legs: Leg[]): number {
  let t = 0;
  legs.forEach((l, k) => {
    const sg = segs[l.seg];
    t += ((l.p1 - l.p0) / segSpeed(sg)) * (1 + 2.5 * segCong[l.seg]);
    if (k < legs.length - 1) { const nt = nodeType[legEndNode(l)]; t += nt === J_LIGHT ? 2.5 : nt === J_STOP ? 1.4 : nt === J_YIELD ? 0.8 : 0; }
  });
  return t;
}

/**
 * A car held up on the road it has just left looks for a better way on from here, as drivers do when
 * they hit a jam: it takes the new route if it is clearly quicker (by a tenth) and carries on the way
 * it is already facing.
 */
function reroute(c: Car): void {
  const cur = c.legs[c.li], last = c.legs[c.legs.length - 1];
  if (c.li >= c.legs.length - 2) return;
  const sg = segs[cur.seg], gl = segs[last.seg];
  const fresh = route(cur.seg, cur.fwd ? c.p : sg.len - c.p, last.seg, last.fwd ? last.p1 : gl.len - last.p1, 1 + Math.random() * 1000);
  if (!fresh || fresh.length < 2 || fresh[0].seg !== cur.seg || fresh[0].fwd !== cur.fwd) return;
  const rest = fresh.slice(1);
  if (rest.every((l, k) => c.legs[c.li + 1 + k]?.seg === l.seg && c.legs[c.li + 1 + k]?.fwd === l.fwd)) return;
  c.rerouteAt = simTime;
  if (legsCost([{ ...cur, p0: c.p }, ...rest]) > legsCost([{ ...cur, p0: c.p }, ...c.legs.slice(c.li + 1)]) * 0.9) return;
  // The current leg runs to its node again (a ring arc's may have been cut short for the old exit).
  cur.p1 = fresh[0].p1;
  c.legs = [...c.legs.slice(0, c.li + 1), ...rest];
  markRampLegs(c.legs);
  alignRingLegs(c.legs, c.vehicle);
  c.nextLane = -1;
  reroutes++;
}
let reroutes = 0;

// ---- people crossing -------------------------------------------------------------------------------
/** The sideways band (lo, hi in the crossing's across direction) of the traffic arriving at, or leaving, its junction. */
function crossingHalf(cr: Crossing, arriving: boolean): [number, number] {
  if (segs[cr.seg].oneway) return [cr.lo, cr.hi];
  // Arriving at the b end is travelling a→b, on the right of a→b; leaving from the a end is too.
  return (cr.end === 1) === arriving ? [0, cr.hi] : [cr.lo, 0];
}

/** What a signalled crossing's heads show now. */
function crossingSignal(cr: Crossing): 'walk' | 'flash' | 'stop' {
  const plan = sigPlan[cr.node];
  if (!plan) return 'walk';
  if (cr.fromPlan !== plan) { cr.from = crossingFrom(plan, segs[cr.seg].id, cr.end); cr.fromPlan = plan; }
  return crossingState(plan, sigPhase[cr.node], sigT[cr.node], sigLen[cr.node], cr.from!, (cr.hi - cr.lo + 0.1) / WALK_SPEED);
}

/**
 * Whether stepping out now would put someone in front of a car: one arriving along the road that could
 * not stop in time, one on the crossing, or one in the junction box about to cross it. A car standing
 * at its line is no threat: it will wait.
 */
function crossingBusy(cr: Crossing): boolean {
  const sg = segs[cr.seg];
  for (const arriving of [true, false]) {
    const fwd = arriving ? cr.end === 1 : cr.end === 0;
    if (!fwd && sg.oneway) continue;
    for (let l = 0; l < Math.max(1, dirLanes[cr.seg * 2 + (fwd ? 0 : 1)]); l++) for (const slot of laneCars[laneKey(cr.seg, fwd, l)]) {
      const o = slots[slot];
      if (!o) continue;
      const len = vehicleLength(o.vehicle);
      // How far its nose is from the near edge of the crossing, along its way (arriving: from the
      // segment's end, not a trip's last leg's end, which may stop short of it).
      const toZebra = arriving ? sg.len - o.p - cr.dist - ZEBRA_HALF - len / 2 : cr.dist - ZEBRA_HALF - o.p - len / 2;
      const past = -(2 * ZEBRA_HALF + len);
      if (toZebra < past) continue;
      if (toZebra <= 0.05) return true;
      // Too fast to stop for someone stepping out, coming in or going out.
      if (o.v > 0.3 && toZebra < (o.v * o.v) / (2 * driverFor(o.vehicle).b) + 0.4) return true;
      // Kept waiting at the line long enough: its turn.
      if (arriving && o.stuck > WALK_COURTESY && toZebra < 0.8) return true;
    }
  }
  for (const slot of boxCars[cr.node] ?? []) {
    const o = slots[slot];
    if (!o || o.box !== cr.node) continue;
    const entry = o.legs[o.boxLi], exit = o.legs[o.boxLi + 1];
    if (entry?.seg === cr.seg || exit?.seg === cr.seg) return true;
  }
  // A car about to turn in off another road, moving too fast to have stopped for them.
  for (const a of nodeIn[cr.node] ?? []) {
    if (a.seg === cr.seg) continue;
    for (let l = 0; l < Math.max(1, dirLanes[a.seg * 2 + (a.fwd ? 0 : 1)]); l++) for (const slot of laneCars[laneKey(a.seg, a.fwd, l)]) {
      const o = slots[slot], next = o?.legs[o.li + 1];
      if (!o || !next || next.seg !== cr.seg) continue;
      if (o.v >= 0.5 && (o.legs[o.li].p1 - o.p) / o.v < 1.5) return true;
      // Waiting a while to turn in across the crossing: its turn too.
      if (o.stuck > WALK_COURTESY && o.legs[o.li].p1 - o.p < approachSetback[a.seg * 2 + (a.fwd ? 0 : 1)] + 0.5) return true;
    }
  }
  return false;
}

/** People on a crossing car `c` will pass over at `node` (its own zebra coming in, the next road's going out): it must wait. */
function walkersBlock(c: Car, node: number): boolean {
  const leg = c.legs[c.li], next = c.legs[c.li + 1];
  const on = (index: number, arriving: boolean): boolean => {
    if (index < 0) return false;
    const cr = crossings[index];
    const [a, b] = crossingHalf(cr, arriving);
    // Anyone in its half, or walking towards it and not yet across it, will be in its way.
    if (cr.walkers.some(w => (w.dir > 0 ? w.u < b + 0.15 : w.u > a - 0.15))) return true;
    // At a signal, people waiting on the walk have the right of way over traffic turning across them.
    return !arriving && nodeType[node] === J_LIGHT && (cr.waiting[0] > 0 || cr.waiting[1] > 0) && crossingSignal(cr) === 'walk';
  };
  return on(crossingAt[leg.seg * 2 + (leg.fwd ? 1 : 0)], true) || (!!next && on(crossingAt[next.seg * 2 + (next.fwd ? 0 : 1)], false));
}

/** Whether anyone is on a crossing at a node. */
function walkersOnCrossingsAt(node: number): boolean {
  for (const cr of crossings) if (cr.node === node && cr.walkers.length) return true;
  return false;
}

/** People arrive at the kerbs, step out when their crossing lets them, and walk across. */
function stepWalkers(dt: number): void {
  const hour = cityHour(), night = hour < 6 || hour > 22 ? 0.3 : 1;
  // Start somewhere different each step, so when the city's walkers run out no crossing always misses.
  walkerStart = crossings.length ? (walkerStart + 1) % crossings.length : 0;
  for (let ci = 0; ci < crossings.length; ci++) {
    const cr = crossings[(ci + walkerStart) % crossings.length];
    for (const end of [0, 1] as const) {
      if (walkersOut < MAX_WALKERS && cr.waiting[end] < MAX_WAITING && Math.random() < cr.rate * trafficScale * night * dt) { cr.waiting[end]++; walkersOut++; }
    }
    if (cr.waiting[0] || cr.waiting[1]) {
      const allowed = nodeType[cr.node] !== J_LIGHT || crossingSignal(cr) === 'walk';
      if (allowed && !crossingBusy(cr)) for (const end of [0, 1] as const) {
        if (!cr.waiting[end] || simTime - cr.lastStep[end] < 0.7) continue;
        cr.waiting[end]--; cr.lastStep[end] = simTime;
        cr.walkers.push({ u: end === 0 ? cr.lo - 0.05 : cr.hi + 0.05, dir: end === 0 ? 1 : -1, v: WALK_SPEED * (0.85 + Math.random() * 0.3), id: ++walkerSeq });
      }
    }
    for (let k = cr.walkers.length - 1; k >= 0; k--) {
      const w = cr.walkers[k];
      w.u += w.dir * w.v * dt;
      if (w.u > cr.hi + 0.06 || w.u < cr.lo - 0.06) { cr.walkers.splice(k, 1); walkersOut--; }
    }
  }
}

/** How many people come to each crossing: more among busy buildings, a trickle among quiet ones. */
function refreshCrossingRates(): void {
  for (const cr of crossings) {
    let busy = 0;
    const x0 = Math.floor(cr.cx), z0 = Math.floor(cr.cz);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const x = x0 + dx, z = z0 + dz;
      if (x < 0 || z < 0 || x >= GRID || z >= GRID) continue;
      const i = z * GRID + x;
      if (isZone(kind[i])) busy += level[i];
    }
    cr.rate = walkRateOverride >= 0 ? walkRateOverride : Math.min(0.12, Math.max(0.005, busy * 0.002));
  }
}

/** Everyone at or on a crossing, for drawing: x, z, heading, 1 waiting or 2 crossing, and who. */
function walkerFrame(): Float32Array {
  const out: number[] = [], half = GRID / 2;
  for (const cr of crossings) {
    const tx = cr.uz, tz = -cr.ux;
    for (const w of cr.walkers) out.push(cr.cx + cr.ux * w.u - half, cr.cz + cr.uz * w.u - half, Math.atan2(cr.ux * w.dir, cr.uz * w.dir), 2, w.id);
    for (const end of [0, 1] as const) for (let k = 0; k < Math.min(3, cr.waiting[end]); k++) {
      const u = end === 0 ? cr.lo - 0.1 : cr.hi + 0.1, along = (k - 1) * 0.07, dir = end === 0 ? 1 : -1;
      out.push(cr.cx + cr.ux * u + tx * along - half, cr.cz + cr.uz * u + tz * along - half, Math.atan2(cr.ux * dir, cr.uz * dir), 1, (cr.seg * 7 + end * 3 + k) * 2654435761 % 100000);
    }
  }
  return new Float32Array(out);
}

/** A car leaves its leg: count it, and its delay there, against that direction of the road. */
function countLeft(c: Car): void {
  const leg = c.legs[c.li], dk = leg.seg * 2 + (leg.fwd ? 0 : 1);
  if (flowCount[dk] < 65535) flowCount[dk]++;
  delayAvg[dk] = delayAvg[dk] === 0 ? c.stood : delayAvg[dk] * 0.9 + c.stood * 0.1;
  c.stood = 0;
}

/** How fast a driver would go on a leg's road, before curves and anything ahead. */
const roadSpeedFor = (c: Car, seg: number): number => segSpeed(segs[seg]) * (c.vehicle === 7 ? 1.55 : 1) * c.pace;

/**
 * How fast car `c` wants to go where it is: its road's speed, no faster than the road's curves allow,
 * and slowing in time for a tighter turn or a slower road at the next node.
 */
function desiredSpeed(c: Car): number {
  const leg = c.legs[c.li];
  let v = Math.min(roadSpeedFor(c, leg.seg), segCurveV[leg.seg]);
  const next = c.legs[c.li + 1];
  if (next) {
    const vNext = Math.min(roadSpeedFor(c, next.seg), segCurveV[next.seg], turnSpeed(leg, next));
    v = Math.min(v, approachSpeed(vNext, leg.p1 - c.p, driverFor(c.vehicle).b));
  } else {
    // Arriving: slow to turn in off the road, rather than stopping in the lane.
    v = Math.min(v, approachSpeed(ARRIVE_SPEED, leg.p1 - c.p, driverFor(c.vehicle).b));
  }
  return v;
}

/** What controls the junction at a node, for a driver arriving on a given approach. */
function controlAt(node: number, seg: number, fwd: boolean): string {
  switch (nodeType[node]) {
    case J_LIGHT: return 'signals';
    case J_STOP: return 'all-way stop';
    case J_RING: return 'roundabout';
    case J_YIELD: return !nodePriority[node] ? 'no priority: first come, first served' : majorIn[seg * 2 + (fwd ? 0 : 1)] ? 'major road: has priority' : 'minor road: gives way';
    default: return '';
  }
}

/** Which way a direction of a road runs, by its heading at the far end. */
function heading(seg: number, fwd: boolean): string {
  const pose = { x: 0, z: 0, tx: 0, tz: 0 }, s = segs[seg];
  Network.poseAt(s, fwd ? s.len : 0, pose);
  const tx = fwd ? pose.tx : -pose.tx, tz = fwd ? pose.tz : -pose.tz;
  return Math.abs(tx) > Math.abs(tz) ? (tx > 0 ? 'Eastbound' : 'Westbound') : (tz > 0 ? 'Southbound' : 'Northbound');
}

/** The road inspector: a line per direction with its flow, speed, queue and delay, and what controls its end. */
function roadReport(segId: number, tile: number): TileReport | null {
  const i = segs.findIndex(s => s.id === segId);
  if (i < 0) return null;
  const s = segs[i], one = s.oneway;
  const lanes = [dirLanes[i * 2], dirLanes[i * 2 + 1]];
  const report: TileReport = {
    tile, name: `${ROAD_LABEL[s.kind] ?? 'Road'}${one ? ' (one-way)' : ''}`, level: 0, occupants: 0,
    status: `${one ? lanes[0] : `${lanes[0]} + ${lanes[1]}`} lane${lanes[0] + (one ? 0 : lanes[1]) === 1 ? '' : 's'} · ${s.len.toFixed(1)} cells${s.calm ? ' · traffic calmed' : ''}`,
    details: [], blockers: [], coverage: {}, neglect: 0,
  };
  for (const fwd of one ? [true] : [true, false]) {
    const dk = i * 2 + (fwd ? 0 : 1);
    let n = 0, speed = 0, queued = 0;
    for (let l = 0; l < Math.max(1, dirLanes[dk]); l++) for (const slot of laneCars[laneKey(i, fwd, l)]) {
      const c = slots[slot];
      if (!c) continue;
      n++; speed += c.v / Math.max(0.1, Math.min(segSpeed(s), segCurveV[i]));
      if (c.v < 0.3) queued++;
    }
    const end = fwd ? segB[i] : segA[i], control = controlAt(end, i, fwd);
    report.details.push(`${heading(i, fwd)}: ${Math.round(flowRate[dk])} vehicles/min · ${n ? `speed ${Math.round((speed / n) * 100)}% of the limit` : 'empty'} · ${queued} queued · ${delayAvg[dk].toFixed(1)} s delay${control ? ` · ${control}` : ''}`);
  }
  if (segCong[i] > 0.5) report.blockers.push('Congested: more lanes, another route, or a better junction at its end would help');
  return report;
}

/** What a vehicle's lamps show, as frame flags: see CAR_BRAKE and the rest in messages.ts. */
function signalsOf(c: Car): number {
  let f = 0;
  if (simTime - c.brakeT < 0.3) f |= CAR_BRAKE;
  if (c.crash !== undefined && incidents.crashes.has(c.crash)) f |= CAR_LEFT | CAR_RIGHT;
  else if (c.chT >= 0 && c.lane !== c.chLane) f |= c.lane > c.chLane ? CAR_LEFT : CAR_RIGHT;
  else if (c.leavingBay || (c.inBay && (c.dwellUntil ?? 0) > 0 && c.dwellUntil! <= simTime)) f |= CAR_LEFT; // pulling out of a lay-by
  else if (c.calls?.[c.callIdx ?? 0]?.bay && c.calls[c.callIdx ?? 0].li === c.li && c.calls[c.callIdx ?? 0].p - c.p < 1.5 && !c.inBay) f |= CAR_RIGHT; // pulling in
  else {
    const leg = c.legs[c.li], next = c.legs[c.li + 1];
    if (next && leg.p1 - c.p < 3.5 && nodeType[legEndNode(leg)] !== J_PLAIN) {
      const k = turnKind(leg, next);
      if (k === 1) f |= CAR_RIGHT; else if (k === 2) f |= CAR_LEFT;
    }
  }
  if (c.mission && (c.mission.kind === 'fire' || c.mission.kind === 'crash' || c.mission.kind === 'heist')) f |= CAR_BLUE;
  const endNode = c.li < c.legs.length - 1 ? legEndNode(c.legs[c.li]) : -1;
  const patience = 30 + (endNode >= 0 && sigPlan[endNode] ? cycleOf(sigPlan[endNode]!) * (sigPlan[endNode]!.adaptive ? 2 : 1) : 0);
  if (c.stuck > patience - 0.5) f |= CAR_LEAVING;
  return f;
}

let frames = 0;
function writeFrame(): void {
  const out = new Float32Array(MAX_CARS * 4);
  const carHeights = new Float32Array(MAX_CARS);
  const carPitch = new Float32Array(MAX_CARS);
  const carIds = new Uint32Array(MAX_CARS);
  const carFlags = new Uint8Array(MAX_CARS);
  spawnSpace.clear();
  const half = GRID / 2;
  for (let s = 0; s < MAX_CARS; s++) {
    const c = slots[s];
    const o = s * 4;
    if (!c) continue;
    const world = trafficSpace.poses.get(s) ?? vehiclePose(c, c.li, c.p);
    out[o] = world.x - half;
    out[o + 1] = world.z - half;
    out[o + 2] = world.angle;
    out[o + 3] = c.vehicle;
    carHeights[s] = world.y ?? 0;
    const leg = c.legs[c.li], seg = segs[leg.seg], d = leg.fwd ? c.p : seg.len - c.p;
    carPitch[s] = Math.atan((roadHeight(seg, Math.min(seg.len, d + 0.1)) - roadHeight(seg, Math.max(0, d - 0.1))) / 0.2) * (leg.fwd ? -1 : 1);
    carIds[s] = c.uid; spawnSpace.set(s, world);
    carFlags[s] = signalsOf(c);
  }
  const cong = new Uint8Array(segs.length);
  for (let i = 0; i < segs.length; i++) cong[i] = Math.min(255, (segCong[i] * 255) | 0);
  // Every signal's clock, so the lamps show what traffic is actually doing.
  const lit: number[] = [];
  for (let n = 0; n < sigPlan.length; n++) if (sigPlan[n]) lit.push(nodeIds[n], sigPhase[n], sigT[n], sigLen[n]);
  const signals = new Float32Array(lit);
  // The water level changes slowly, so it rides along every third frame.
  const wet = frames++ % 3 === 0 ? river.frame() : undefined, flooded = wet ? river.flooded.slice() : undefined;
  const walkers = walkerFrame();
  post({ type: 'frame', carHeights, carPitch, carIds, carFlags, walkers, cars: out, segCong: cong, signals, serial, simTime, cityTime: tick + subCount / SIM_HZ, water: wet, flooded }, [out.buffer, carIds.buffer, carFlags.buffer, walkers.buffer, cong.buffer, carHeights.buffer, carPitch.buffer, ...(wet ? [wet.buffer, flooded!.buffer] : [])]);
}

// ---- census, utilities, pollution, growth --------------------------------------------------------
function census(): void {
  refreshCrossingRates();
  comCache = null; // the shops, re-listed from the new job tiles when next wanted
  parkReach = parkAccess(kind, roadConnected);
  pop = 0; comJobs = 0; indJobs = 0; officeJobs = 0; buildings = 0;
  resTiles = []; resW = []; jobTiles = []; jobW = [];
  let rw = 0, jw = 0;
  let capP = 0, capW = 0, capS = 0, needP = 0, needW = 0, upkeep = 0;
  fishingIncome = 0; docks = 0;
  let dirtyCap = 0;
  const outlets: { flow: number; cap: number; treatment: number }[] = [];
  treatedSewage = 0;
  // Power and water travel along the roads: each connected road network shares its own plants.
  const grid = new Map<number, number[]>(); // component -> [capP, capW, capS, needP, needW]
  const utility = (i: number, slot: number, v: number): void => {
    const c = utilityComponent(i);
    let row = grid.get(c);
    if (!row) grid.set(c, row = [0, 0, 0, 0, 0]);
    row[slot] += v;
  };

  // Services first: capacity only counts when the building is on the road network and sited correctly.
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    if (!isService(k)) continue;
    const spec = SERVICES[k];
    const budget = serviceFunding(spec, funding);
    const output = fundingOutput(budget);
    upkeep += spec.upkeep * budget;
    flags[i] = 0;
    const x = i % GRID, z = (i / GRID) | 0;
    if (spec.decoration && !spec.civic) continue;
    const sited = !spec.needsWater || touchesWater(terrain, x, z);
    if (!tileConnected(i) || !sited) { flags[i] = F_NO_ROAD; continue; }
    capP += spec.power * output; utility(i, 0, spec.power * output);
    capW += spec.water * output; utility(i, 1, spec.water * output);
    capS += spec.sewage * output; utility(i, 2, spec.sewage * output);
    if (!spec.decoration && (spec.civic || spec.transport || spec.treatment)) {
      const p = spec.transport === 'air' ? 30 : 3;
      needP += p; needW += 2; utility(i, 3, p); utility(i, 4, 2);
    }
    if (k === T_PUMP) {
      const f = adjacentFlow(terrain, x, z);
      if (f >= 0 && riverPollution[f] > 0.25) dirtyCap += spec.water * output;
    } else if (k === T_TOWER) {
      if (pollution[i] > 5) dirtyCap += spec.water * output;
    } else if (k === T_OUTLET || k === T_TREATMENT) {
      outlets.push({ flow: adjacentFlow(terrain, x, z), cap: spec.sewage * output, treatment: spec.treatment ?? 0 });
    } else if (k === T_DOCKS) {
      // The quay employs people like a workshop, and the boats sell what they catch. Sewage in the
      // river upstream of the dock thins the catch, so an outlet in the wrong place costs money.
      needP += 4; needW += 2; utility(i, 3, 4); utility(i, 4, 2);
      indJobs += DOCK_JOBS;
      jw += 3; jobTiles.push(i); jobW.push(jw);
      const f = adjacentFlow(terrain, x, z);
      const clean = f >= 0 ? Math.max(0, 1 - riverPollution[f] * 1.6) : 1;
      fishingIncome += DOCK_CATCH * output * clean;
      docks++;
    }
  }

  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    if (!isZone(k)) { if (!isService(k)) flags[i] = 0; continue; }
    const l = level[i];
    if (l > 0) buildings++;
    const ok = tileConnected(i);
    const zi = zoneBase(k) - T_RES;
    if (l > 0 && ok) {
      // Farms run little machinery but water their fields.
      const p = POWER_DEMAND[zi][l] * (k === T_FARM ? 0.4 : 1), w = WATER_DEMAND[zi][l] * (k === T_FARM ? 1.5 : 1);
      needP += p; needW += w; utility(i, 3, p); utility(i, 4, w);
    }
    if (k === T_RES) {
      pop += RES_POP[l];
      if (l > 0 && ok) { rw += l; resTiles.push(i); resW.push(rw); }
    } else if (k === T_COM) {
      comJobs += COM_JOBS[l];
      if (l > 0 && ok) { jw += l * 1.4; jobTiles.push(i); jobW.push(jw); }
    } else if (k === T_OFFICE) {
      officeJobs += OFFICE_JOBS[l];
      if (l > 0 && ok) { jw += l * 1.2; jobTiles.push(i); jobW.push(jw); }
    } else if (k === T_LEISURE) {
      comJobs += LEISURE_JOBS[l];
      if (l > 0 && ok) { jw += l * 1.3; jobTiles.push(i); jobW.push(jw); }
    } else if (k === T_FARM) {
      indJobs += FARM_JOBS[l];
      if (l > 0 && ok) { jw += l * 0.7; jobTiles.push(i); jobW.push(jw); }
    } else {
      indJobs += IND_JOBS[l];
      if (l > 0 && ok) { jw += l; jobTiles.push(i); jobW.push(jw); }
    }
  }

  const fP = needP > 0 ? Math.min(1, capP / needP) : 1;
  power = [Math.round(needP), capP];
  water = [Math.round(needW), capW];
  sewage = [Math.round(needW), capS];
  dirtyShare = capW > 0 ? dirtyCap / capW : 0;

  let resN = 0, resUnserved = 0, polSum = 0;
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    if (!isZone(k) && !SERVICES[k]?.civic && !SERVICES[k]?.transport && !SERVICES[k]?.treatment) continue;
    let f = 0;
    if (!tileConnected(i)) f |= F_NO_ROAD;
    else if (level[i] > 0 && !SERVICES[k]?.decoration) {
      // Supply is shared within the building's own road network, not across the whole map.
      const row = grid.get(utilityComponent(i)) ?? [0, 0, 0, 0, 0];
      const lp = row[3] > 0 ? Math.min(1, row[0] / row[3]) : 1, lw = row[4] > 0 ? Math.min(1, row[1] / row[4]) : 1, ls = row[4] > 0 ? Math.min(1, row[2] / row[4]) : 1;
      const h = tileHash(i);
      if (h >= lp) f |= F_NO_POWER;
      if (tileHash(i + 7919) >= lw) f |= F_NO_WATER;
      if (tileHash(i + 104729) >= ls) f |= F_NO_SEWAGE;
    }
    flags[i] = f;
    if (k === T_RES && level[i] > 0) {
      resN++;
      if (f) resUnserved++;
      polSum += pollution[i];
    }
  }
  unservedRes = resN ? resUnserved / resN : 0;
  resPollution = resN ? polSum / resN : 0;

  // Sewage dumped in the river drifts downstream and fades.
  riverPollution.fill(0);
  const load = capS > 0 ? Math.min(1, needW / capS) : 0;
  for (const o of outlets) {
    if (o.flow < 0) continue;
    const filtered = o.treatment * fP;
    treatedSewage += o.cap * load * filtered;
    for (let j = o.flow; j < riverPollution.length; j++) {
      riverPollution[j] = Math.min(1, riverPollution[j] + (o.cap * load / 1500) * (1 - filtered) * Math.exp(-(j - o.flow) / 70));
    }
  }

  civicState = civicCoverage(kind, level, tileConnected, civicEfficiency);
  const civic = civicState.average;
  const needs = cityLevel >= 2 ? ['health', 'education', 'fire', 'safety', 'waste'] as const : cityLevel >= 1 ? ['health', 'education'] as const : [];
  const serviceScore = needs.length ? needs.reduce((sum, k) => sum + civic[k], 0) / needs.length : 70;
  const crimePenalty = buildings ? incidents.crime.reduce((sum, v) => sum + v, 0) / buildings * 0.4 : 0;
  happiness = Math.round(clamp(55 + effects.happiness - crimePenalty + serviceScore * 0.3 + civic.leisure * 0.15 - unservedRes * 25 - dirtyShare * 25 - resPollution * 3 - Math.max(0, extras.taxes[0] - 10) * 1.5 - (disasters.active ? 6 : 0) - Math.max(0, commuteAvg - 25) * 0.3, 0, 100));
  const jobs = comJobs + indJobs + officeJobs;
  const taxPenalty = (extras.taxes[0] - 10) / 40;
  const zoneTax = (z: number): number => (extras.taxes[z] - 10) / 40;
  // Goods: factories and farms supply the shops; a shortfall is imported and a surplus exported.
  const links = { entries: gateCount(), railLines: transit.intercity.length, docks, airports: transit.airports.length };
  goods = goodsFlow(kind, level, pop, links);
  visitors = tourismFlow(kind, level, riverDistance, links, happiness, extras);
  const commutePenalty = clamp((commuteAvg - 25) / 50, 0, 1);
  const balance = (jobs - pop) / Math.max(60, pop + jobs);
  demand[0] = clamp((happiness - 65) / 160 + 0.3 + 0.7 * balance - taxPenalty - 0.6 * commutePenalty - 0.4 * unservedRes - 0.5 * dirtyShare - resPollution / 12, -1, 1);
  demand[1] = clamp(0.25 + 0.7 * (pop * 0.4 - comJobs) / Math.max(50, pop * 0.4 + comJobs) - zoneTax(1) + Math.min(0.15, visitors.visitors / 4000), -1, 1);
  demand[2] = clamp(0.25 + 0.7 * (pop * 0.5 - indJobs) / Math.max(50, pop * 0.5 + indJobs) - zoneTax(2) + 0.3 * goods.importShare - 0.4 * goods.unsold, -1, 1);
  demand[3] = cityLevel >= OFFICE_UNLOCK ? clamp(0.2 + (pop * 0.35 - officeJobs) / Math.max(60, pop * 0.35 + officeJobs) * 0.6 + civic.education / 250 - zoneTax(3), -1, 1) : -1;
  const signature = `${serial}:` + Array.from(kind, (k, i) => SERVICES[k]?.transport && !flags[i] ? i : '').filter(String).join(',');
  if (signature !== transitSignature) {
    transit = transitNetwork(kind, i => tileConnected(i) && flags[i] === 0, (a, b) => kind[a] === T_TROLLEY ? !!wiredRoute(accSeg[a], accS[a], accSeg[b], accS[b]) : kind[a] === T_STATION ? component[segA[accSeg[a]]] === component[segA[accSeg[b]]] : !!route(accSeg[a], accS[a], accSeg[b], accS[b]), gates);
    taxiStops = Array.from(kind.keys()).filter(i => kind[i] === T_TAXI && tileConnected(i) && flags[i] === 0);
    for (let i = 0; i < slots.length; i++) if (slots[i]?.taxiStop !== undefined && !taxiStops.includes(slots[i]!.taxiStop!)) freeCar(i);
    transitSignature = signature; transitTokens = transit.lines.map(() => 0); transitDepartures = transit.lines.map(() => 12);
    busStopTiles = [...new Set(transit.lines.filter(l => l.mode === 'bus').flatMap(l => [l.a, l.b]))];
    refreshBusStops();
    for (let i = 0; i < slots.length; i++) if (slots[i]?.line !== undefined) freeCar(i);
  }
  riders = Math.round(riderWindow + taxiWindow); airPassengers = Math.round(airWindow); railPassengers = Math.round(railWindow);
  fareIncome = (taxiWindow / 60 * 0.16 + riderWindow / 60 * 0.08 + airWindow / 60 * 0.2 + railWindow / 60 * 0.12) * effects.fare;
  tollIncome = tollWindow / 60 * effects.toll;
  tripRate = rw * 0.022;
  extRate = entries.length ? (rw + jw) * 0.005 : 0;

  // Disconnected buildings do not pay taxes; utility failures reduce economic output.
  taxIncome = 0;
  for (let i = 0; i < N_TILES; i++) {
    if (!isZone(kind[i]) || !level[i] || (flags[i] & F_NO_ROAD)) continue;
    const k = kind[i];
    let amount = zoneOccupants(k, level[i]) * (k === T_RES ? 0.012 : 0.015);
    // Hotels and restaurants trade on visitors, who come for the parks and the waterfront.
    if (k === T_LEISURE) amount *= tourismAppeal(i) * (districtPolicy(i, 'tourist') ? 1.25 : 1);
    // Better addresses pay more; shops that have to import their stock pay less.
    const base = zoneBase(k);
    if (base !== T_IND) amount *= 0.8 + landValue[i] / 100 * 0.7;
    if (base === T_COM) amount *= 1 - 0.3 * goods.importShare;
    const operating = (flags[i] & (F_NO_POWER | F_NO_WATER | F_NO_SEWAGE)) ? 0.5 : 1;
    taxIncome += amount * operating * taxAt(i) / 10 * (1 - incidents.crime[i] / 200) * (incidents.fires.has(i) ? 0 : 1);
  }
  // Local policies are billed per building in the district.
  districtCost = 0;
  if (extras.districtPolicies.some(m => m)) {
    const perDistrict = new Array(DISTRICT_COUNT).fill(0);
    for (let i = 0; i < N_TILES; i++) if (extras.district[i] && isZone(kind[i]) && level[i]) perDistrict[extras.district[i] - 1]++;
    extras.districtPolicies.forEach((mask, d) => {
      for (const id of DISTRICT_POLICY_IDS) if (districtHas(mask, id)) districtCost += 0.2 + DISTRICT_POLICIES[id].perBuilding * perDistrict[d];
    });
  }
  policyCost = policyExpense(policies, pop);
  serviceExpense = upkeep;
  loanExpense = Math.min(LOAN_PAYMENT, debt);
  netIncome = taxIncome + fishingIncome + goods.exportIncome + visitors.income - roadUpkeep - serviceExpense - policyCost - districtCost - loanExpense;
}

/** How much a leisure business earns over a plain shop: parks and a river view draw the visitors. */
function tourismAppeal(i: number): number {
  const x = i % GRID, z = Math.floor(i / GRID);
  let river = false;
  for (let dz = -2; dz <= 2 && !river; dz++) for (let dx = -2; dx <= 2; dx++) {
    const nx = x + dx, nz = z + dz;
    if (nx >= 0 && nz >= 0 && nx < GRID && nz < GRID && terrain.water[nz * GRID + nx]) { river = true; break; }
  }
  return 1.2 + (civicState.coverage.leisure[i] ?? 0) * 0.6 + (river ? 0.4 : 0);
}

/** Demand for a zone kind: specialised zones share their core zone's, once they are unlocked. */
function zoneDemand(k: number): number {
  if (k === T_LEISURE && cityLevel < LEISURE_UNLOCK) return -1;
  return demand[zoneBase(k) - T_RES];
}

function civicEfficiency(i: number): number {
  const spec = SERVICES[kind[i]];
  if (!spec?.civic || flags[i] & (F_NO_ROAD | F_NO_POWER | F_NO_WATER | F_NO_SEWAGE)) return 0;
  if (spec.decoration) return fundingOutput(serviceFunding(spec, funding));
  const congestion = accSeg[i] >= 0 ? segCong[accSeg[i]] ?? 0 : 1;
  const grants = spec.civic === 'education' ? effects.educationCapacity : 1;
  return fundingOutput(serviceFunding(spec, funding)) * (1 - 0.5 * Math.min(1, congestion)) * grants;
}

function spreadPollution(): void {
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    const green = districtPolicy(i, 'green') ? 0.5 : 1;
    if (k === T_IND) pollution[i] += IND_POLLUTION[level[i]] * effects.industryPollution * green;
    else if (isService(k)) pollution[i] += SERVICES[k].pollution * green;
  }
  for (let i = 0; i < N_TILES; i++) {
    let sum = 0;
    for (let d = 0; d < 4; d++) {
      const n = neighbor(i, d);
      sum += n >= 0 ? pollution[n] : pollution[i];
    }
    let v = (pollution[i] * 0.6 + sum * 0.1) * 0.965;
    if (terrain.water[i]) v *= 0.3;
    pollutionTmp[i] = v < 0.01 ? 0 : v;
  }
  const t = pollution;
  pollution = pollutionTmp;
  pollutionTmp = t;
}

/** City-block distance from each tile to the nearest shop or office, capped at 15. */
const shopDistance = new Uint8Array(N_TILES);
function measureShopDistance(): void {
  for (let i = 0; i < N_TILES; i++) shopDistance[i] = kind[i] === T_COM || kind[i] === T_OFFICE || kind[i] === T_LEISURE ? 0 : 15;
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
    const i = z * GRID + x;
    if (x > 0) shopDistance[i] = Math.min(shopDistance[i], shopDistance[i - 1] + 1);
    if (z > 0) shopDistance[i] = Math.min(shopDistance[i], shopDistance[i - GRID] + 1);
  }
  for (let z = GRID - 1; z >= 0; z--) for (let x = GRID - 1; x >= 0; x--) {
    const i = z * GRID + x;
    if (x < GRID - 1) shopDistance[i] = Math.min(shopDistance[i], shopDistance[i + 1] + 1);
    if (z < GRID - 1) shopDistance[i] = Math.min(shopDistance[i], shopDistance[i + GRID] + 1);
  }
}
/** Homes densify near commerce: towers within 3 cells, apartments within 6, houses beyond. */
const residentialCap = (i: number): number => shopDistance[i] <= 3 ? 3 : shopDistance[i] <= 6 ? 2 : 1;

function grow(): void {
  measureShopDistance();
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    if (!isZone(k)) continue;
    const l = level[i];
    if (incidents.fires.has(i)) continue;
    const f = flags[i];
    if (f & F_NO_ROAD) {
      if (l > 0 && Math.random() < 0.08) { level[i] = l - 1; age[i] = 0; }
      continue;
    }
    // An empty lot the water reaches never builds on: nothing should stand in the river.
    const base = zoneBase(k);
    // Local policy shifts how keen builders are: a tax break draws them, quiet and green streets put
    // shops and factories off.
    let local = districtPolicy(i, 'taxBreak') ? 0.1 : 0;
    if (base === T_COM && districtPolicy(i, 'quiet')) local -= 0.25;
    if (base === T_IND && (districtPolicy(i, 'quiet') || districtPolicy(i, 'green'))) local -= 0.3;
    const d = terrain.shore[i] && l === 0 ? 0 : zoneDemand(k) + (zoneDemand(k) > -1 ? local : 0);
    const p = pollution[i];
    const isRes = k === T_RES;
    if (l === 0) {
      if (airportClearance[i]) continue;
      const appeal = isRes ? Math.max(0, 1 - p / 6) : 1;
      if (Math.random() < Math.max(0, d) * 0.12 * appeal) {
        level[i] = 1;
        age[i] = 0;
        if (isRes && pendingMoveIns.length < 40) pendingMoveIns.push(i);
      }
      continue;
    }
    age[i] = Math.min(65535, age[i] + 1);
    const underserved = isRes && l > 1 && civicShortfalls(i, l, cityLevel, civicState.coverage, true).length > 0;
    neglect[i] = underserved ? neglect[i] + 1 : 0;
    if (neglect[i] >= NEGLECT_LIMIT) {
      level[i] = l - 1; age[i] = 0; neglect[i] = 0;
      continue;
    }
    const served = (f & (F_NO_ROAD | F_NO_POWER | F_NO_WATER | F_NO_SEWAGE)) === 0;
    // Offices take their time: a low block first, a mid-rise once it has settled, and a tower only in
    // a proper City on a good address, instead of shooting up the moment they unlock.
    const office = k === T_OFFICE;
    const minAge = office ? (l === 1 ? 30 : 75) : l === 1 ? 10 : 22;
    const rate = (l === 1 ? 0.06 : 0.03) * (office ? 0.5 : 1);
    const officeTower = !office || l < 2 || (cityLevel >= 4 && landValue[i] >= 45);
    const officeReady = k !== T_OFFICE || civicState.average.education >= (l === 1 ? 25 : 50);
    const civicReady = !isRes || civicShortfalls(i, l + 1, cityLevel, civicState.coverage).length === 0;
    // Towers need an address worth building on, and a high-rise ban stops at mid-rise.
    const valued = base === T_IND || l < 2 || landValue[i] >= 30;
    const cap = districtPolicy(i, 'highriseBan') ? 2 : 3;
    const canUp = !airportClearance[i] && served && officeReady && officeTower && civicReady && valued && l < cap && (l < 2 || cityLevel >= 3) && (!isRes || (p < 3 && l < residentialCap(i)));
    const appeal = base === T_IND ? 1 : 0.55 + landValue[i] / 90;
    if (l < 3 && age[i] > minAge && canUp && Math.random() < Math.max(0, d) * rate * appeal) {
      level[i] = l + 1; age[i] = 0;
      if (isRes && pendingMoveIns.length < 40) pendingMoveIns.push(i);
    } else if (d < -0.15 && Math.random() < -d * 0.05) {
      level[i] = l - 1; age[i] = 0;
    } else if (!served && l > 1 && Math.random() < 0.04) {
      level[i] = l - 1; age[i] = 0;
    } else if ((garbage[i] > 85 || l > cap) && Math.random() < 0.03) {
      // Rubbish nobody collects, or a tower in a district that has since banned them, comes down a floor.
      level[i] = l - 1; age[i] = 0;
    } else if (isRes && p > 6 && Math.random() < 0.05) {
      level[i] = l - 1; age[i] = 0;
    }
  }
  if (incidents.robbed > robbedSeen) {
    money -= 1200 * (incidents.robbed - robbedSeen);
    robbedSeen = incidents.robbed;
    post({ type: 'notice', message: 'A robbery got away with $1,200. Police stations respond to alarms nearby.' });
  }
  const progress = advanceCity(cityLevel, pop);
  cityLevel = progress.level;
  money += netIncome + progress.reward;
  debt = Math.max(0, debt - loanExpense);
  tick++;
}

/** Entrances as a player counts them: the two carriageways of a highway share one gate on the edge. */
function gateCount(): number {
  const distinct: { x: number; z: number }[] = [];
  for (const g of gates) if (!distinct.some(o => Math.hypot(o.x - g.x, o.z - g.z) < 4)) distinct.push(g);
  return distinct.length;
}

function averageOver(field: Float32Array, include: (i: number) => boolean): number {
  let sum = 0, n = 0;
  for (let i = 0; i < N_TILES; i++) if (include(i)) { sum += field[i]; n++; }
  return n ? sum / n : 0;
}

function stats(): Stats {
  return {
    incidents: {
      fires: incidents.fires.size, heists: incidents.heists.size, racers: slots.filter(c => c?.vehicle === 7).length,
      crashes: incidents.crashes.size, crime: incidents.view().crime.length,
      patrols: slots.filter(c => c?.vehicle === 5).length, fireEngines: slots.filter(c => c?.vehicle === 6).length,
      prevented: incidents.prevented, extinguished: incidents.extinguished, damaged: incidents.damaged,
      robbed: incidents.robbed, foiled: incidents.foiled,
    },
    transport: { taxiStops: taxiStops.length, taxiRiders: Math.round(taxiWindow), trolleyLines: transit.lines.filter(l => l.mode === 'trolley').length, busLines: transit.lines.filter(l => l.mode === 'bus').length, railLines: transit.lines.filter(l => l.mode === 'rail').length, intercityLines: transit.intercity.length, subwayLines: transit.lines.filter(l => l.mode === 'subway').length, airports: transit.airports.length, riders, airPassengers, railPassengers, fareIncome }, treatedSewage: Math.round(treatedSewage), entries: gateCount(),
    funding: { ...funding }, policies: { ...policies }, policyExpense: policyCost, tollIncome, fishingIncome, docks, debt, taxIncome, roadExpense: roadUpkeep, serviceExpense, loanExpense, declining: neglect.reduce((n, v) => n + (v > 0 ? 1 : 0), 0),
    cityLevel, happiness, civic: civicState.average,
    money: Math.round(money), pop, jobs: comJobs + indJobs + officeJobs, cars: activeCars, commute: commuteAvg,
    demand: [...demand], tick, roadLength: Math.round(roadLength), buildings,
    noPath, gaveUp, power, water, sewage, dirtyWater: dirtyShare > 0.2, resPollution, income: netIncome + fareIncome + tollIncome,
    taxes: [...extras.taxes] as Stats['taxes'],
    goods: { produced: Math.round(goods.produced), needed: Math.round(goods.needed), exported: Math.round(goods.exported), imported: Math.round(goods.imported), capacity: Math.round(goods.exportCapacity), income: goods.exportIncome, importShare: goods.importShare },
    tourism: { visitors: Math.round(visitors.visitors), income: visitors.income, attraction: Math.round(visitors.attraction) },
    landValue: Math.round(averageOver(landValue, i => isZone(kind[i]) && level[i] > 0)),
    wellbeing: Math.round(averageOver(wellbeing, i => kind[i] === T_RES && level[i] > 0)),
    garbage: Math.round(averageOver(garbage, i => isZone(kind[i]) && level[i] > 0)),
    districtExpense: districtCost,
    disasters: { floods: disasters.floods, tornadoes: disasters.tornadoes, damaged: disasters.damaged, active: disasters.active?.kind ?? null },
    garbageTrucks: slots.filter(c => c?.vehicle === 10).length,
  };
}

function postState(): void {
  const pol = new Uint8Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) pol[i] = Math.min(255, (pollution[i] * 14) | 0);
  const riv = new Uint8Array(riverPollution.length);
  for (let i = 0; i < riv.length; i++) riv[i] = Math.min(255, (riverPollution[i] * 255) | 0);
  for (let i = 0; i < N_TILES; i++) {
    flags[i] &= ~F_DECLINING;
    if (neglect[i]) flags[i] |= F_DECLINING;
  }
  const byte = (field: ArrayLike<number>, scale = 2.55): Uint8Array => { const out = new Uint8Array(N_TILES); for (let i = 0; i < N_TILES; i++) out[i] = Math.max(0, Math.min(255, field[i] * scale)); return out; };
  const maps = { land: byte(landValue), noise: byte(noise), wellbeing: byte(wellbeing), garbage: byte(garbage), crime: byte(incidents.crime) };
  post({ type: 'state', incidents: incidents.view(), incidentSave: incidents.snapshot(), neglect: neglect.slice(), level: level.slice(), flags: flags.slice(), pollution: pol, riverPollution: riv, maps, disaster: disasters.active ? { ...disasters.active, flooded: [...disasters.active.flooded], path: [...disasters.active.path] } : null, stats: stats() });
  postInspection();
}

/** Dispatch from working stations; cars must reach the destination before helping. */
function collectGarbage(tile: number): void {
  const x = tile % GRID, z = Math.floor(tile / GRID), r = GARBAGE_PICKUP_RADIUS;
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const nx = x + dx, nz = z + dz;
    if (nx >= 0 && nz >= 0 && nx < GRID && nz < GRID) garbage[nz * GRID + nx] = 0;
  }
}
/** Recycling centres send trucks round to the fullest bins in their area. */
function dispatchGarbage(): void {
  if (racing) return;
  for (let i = 0; i < N_TILES; i++) {
    if (kind[i] !== T_RECYCLING || flags[i] || !tileConnected(i) || dispatchCooldown.has(i)) continue;
    if (slots.filter(c => c?.mission?.origin === i).length >= 2) continue;
    const r2 = SERVICES[T_RECYCLING].radius! ** 2, x = i % GRID, z = Math.floor(i / GRID);
    let best = -1, worst = 12;
    for (const t of [...resTiles, ...jobTiles]) {
      if (garbage[t] <= worst || (t % GRID - x) ** 2 + (Math.floor(t / GRID) - z) ** 2 > r2) continue;
      if (slots.some(c => c?.mission?.kind === 'garbage' && distance(c.mission.tile, t) <= GARBAGE_PICKUP_RADIUS)) continue;
      best = t; worst = garbage[t];
    }
    if (best >= 0 && spawnTrip(accSeg[i], accS[i], accSeg[best], accS[best], 10, undefined, { kind: 'garbage', origin: i, tile: best, work: 4 })) dispatchCooldown.set(i, 10);
  }
}

function stepIncidents(): void {
  const crimeBefore = extras.districtPolicies.some(m => m) ? Float32Array.from(incidents.crime) : null;
  dispatchGarbage();
  incidents.step(kind, level, pop, cityLevel, Math.random, { fire: effects.fireRate, crime: effects.crimeRate }, tile => { level[tile] = Math.max(0, level[tile] - 1); age[tile] = 0; });
  // A district's own neighborhood watch takes 40% off the crime that built up this second.
  if (crimeBefore) for (let i = 0; i < N_TILES; i++) {
    const rise = incidents.crime[i] - crimeBefore[i];
    if (rise > 0 && districtPolicy(i, 'watch')) incidents.crime[i] -= rise * 0.4;
  }
  for (const [tile, delay] of dispatchCooldown) if (delay <= 1) dispatchCooldown.delete(tile); else dispatchCooldown.set(tile, delay - 1);
  // An occasional two-vehicle collision blocks the occupied lane until police or recovery clear it.
  if (cityLevel >= 2 && activeCars > 12 && incidents.crashes.size < 2 && Math.random() < 0.018) {
    const candidates = [...trafficSpace.poses.keys()].filter(id => slots[id] && !slots[id]!.mission && slots[id]!.crash === undefined);
    const pairs: [number, number][] = [];
    for (let n = 0; n < candidates.length; n++) {
      const a = candidates[n], first = trafficSpace.poses.get(a)!;
      const b = candidates.slice(n + 1).find(id => Math.abs((trafficSpace.poses.get(id)!.y ?? 0) - (first.y ?? 0)) < 0.6 && Math.hypot(trafficSpace.poses.get(id)!.x - first.x, trafficSpace.poses.get(id)!.z - first.z) < 0.95);
      if (b !== undefined) pairs.push([a, b]);
    }
    const pair = pairs[Math.floor(Math.random() * pairs.length)];
    // A calmed street rarely produces a collision: that is what the drivers slowed down for.
    if (pair && !(slots[pair[0]] && segs[slots[pair[0]]!.legs[slots[pair[0]]!.li].seg]?.calm && Math.random() < 0.8)) {
      const [a, second] = pair, first = trafficSpace.poses.get(a)!;
      const tile = Math.max(0, Math.min(N_TILES - 1, Math.floor(first.z) * GRID + Math.floor(first.x)));
      const crash = incidents.crash(first.x, first.z, [a, second], tile, first.y ?? 0);
      slots[a]!.crash = crash; slots[second]!.crash = crash;
    }
  }

  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    const police = k === T_POLICE || k === T_POLICE_HQ;
    if ((k !== T_FIRE && !police) || flags[i] || !tileConnected(i) || dispatchCooldown.has(i) || slots.filter(c => c?.mission?.origin === i).length >= (k === T_POLICE_HQ ? 2 : 1)) continue;
    let mission: Mission | undefined;
    if (k === T_FIRE) {
      const targets = [...incidents.fires.keys()].filter(tile => !slots.some(c => c?.mission?.kind === 'fire' && c.mission.tile === tile)).sort((a, b) => distance(a, i) - distance(b, i));
      for (const tile of targets) if (tileConnected(tile) && route(accSeg[i], accS[i], accSeg[tile], accS[tile])) { mission = { kind: 'fire', origin: i, tile, work: 8 }; break; }
    } else {
      const robbery = [...incidents.heists.keys()].find(tile => tileConnected(tile) && !slots.some(car => car?.mission?.kind === 'heist' && car.mission.tile === tile));
      if (robbery !== undefined && route(accSeg[i], accS[i], accSeg[robbery], accS[robbery])) mission = { kind: 'heist', origin: i, tile: robbery, work: 5 };
      const crash = mission ? undefined : [...incidents.crashes.values()].find(c => !slots.some(car => car?.mission?.crash === c.id));
      if (!mission && crash) {
        const near = [...resTiles, ...jobTiles].filter(t => tileConnected(t)).sort((a, b) => distance(a, crash.tile) - distance(b, crash.tile))[0];
        if (near !== undefined && distance(near, crash.tile) < 6) mission = { kind: 'crash', origin: i, tile: near, crash: crash.id, work: 4 };
      }
      if (!mission) {
        const targets = [...resTiles, ...jobTiles].filter(t => distance(t, i) < SERVICES[k].radius!);
        const tile = targets[Math.floor(Math.random() * targets.length)];
        if (tile !== undefined && !racing) mission = { kind: 'patrol', origin: i, tile, work: 4 };
      }
    }
    if (mission && spawnTrip(accSeg[i], accS[i], accSeg[mission.tile], accS[mission.tile], k === T_FIRE ? 6 : 5, undefined, mission)) dispatchCooldown.set(i, k === T_FIRE ? 8 : 18);
  }
}

// ---- economy, rubbish and disasters -------------------------------------------------------------------
const ROAD_NOISE = [10, 22, 5, 34, 24, 12, 18];
const TRANSIT_STOPS = new Set([T_BUS, T_TROLLEY, T_SUBWAY, T_STATION, T_TAXI]);
function disasterContext() {
  return {
    kind, level, water: terrain.water, riverDistance, cityLevel, enabled: extras.disasters, rate: disasterRate, random: Math.random,
    damage: (tile: number, levels: number) => { level[tile] = Math.max(0, level[tile] - levels); age[tile] = 0; },
    notice: (message: string) => post({ type: 'notice', message }),
    surge: (factor: number) => { river.surge = factor; },
  };
}
/** Once a simulation second: floodwater wears down what it stands on, and the city is warned when it rises. */
function stepWater(): void {
  if (river.floodedCount) {
    for (let i = 0; i < N_TILES; i++) {
      if (!river.flooded[i] || !isZone(kind[i]) || !level[i] || Math.random() > 0.03) continue;
      level[i] = Math.max(0, level[i] - 1); age[i] = 0; disasters.damaged++;
    }
  }
  if (floodWarning > 0) floodWarning--;
  else if (river.floodedCount >= 20 && !disasters.active) {
    post({ type: 'notice', message: 'The river is over its banks: water is spreading over the land. Lower any dam, or raise the ground, to hold it back.' });
    floodWarning = 240;
  }
}
/** Once a simulation second: rubbish builds up, and noise, land value and well-being are re-read. */
function stepEconomy(): void {
  accumulateGarbage(garbage, kind, level, civicState.coverage.waste);
  refreshMaps();
  disasters.step(disasterContext());
  stepWater();
}
/** Noise, transit reach, land value and well-being from the city as it stands. */
function refreshMaps(): void {
  const roadNoise = new Float32Array(N_TILES);
  segs.forEach((seg, j) => {
    if (seg.structure === 2) return;
    const w = ROAD_NOISE[seg.kind] * (0.6 + Math.min(1.5, segCong[j] ?? 0)) * (seg.calm ? 0.6 : 1) * (seg.len / seg.n);
    for (let k = 0; k <= seg.n; k++) {
      const x = Math.floor(seg.pts[k * 2]), z = Math.floor(seg.pts[k * 2 + 1]);
      if (x >= 0 && z >= 0 && x < GRID && z < GRID) roadNoise[z * GRID + x] += w;
    }
  });
  noise = noiseMap({ kind, level, roadNoise, extras });
  transitReach = new Float32Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) {
    if (!TRANSIT_STOPS.has(kind[i]) || flags[i]) continue;
    const r = SERVICES[kind[i]]?.radius ?? 8, x = i % GRID, z = Math.floor(i / GRID);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, nz = z + dz, d = Math.hypot(dx, dz);
      if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID || d > r) continue;
      const t = nz * GRID + nx;
      transitReach[t] = Math.max(transitReach[t], 1 - 0.7 * d / r);
    }
  }
  landValue = landValueMap({ kind, level, water: terrain.water, pollution, noise, crime: incidents.crime, garbage, coverage: civicState.coverage, transit: transitReach, extras }, riverDistance);
  wellbeing = wellbeingMap(kind, level, landValue, noise, pollution, incidents.crime, garbage, civicState.coverage);
}

// ---- main loop -----------------------------------------------------------------------------------
function substep(scale = 1): void {
  const dt = scale / SIM_HZ;
  simTime += dt;
  stepSignals(dt);
  stepCars(dt);
  stepWalkers(dt);
  spawn(dt);
  for (let k = 0; k < WATER_HZ / SIM_HZ; k++) river.step(scale);
  subCount += scale;
  if (subCount >= SIM_HZ) {
    subCount -= SIM_HZ;
    stepIncidents();
    stepEconomy();
    spreadPollution();
    census();
    grow();
    census();
    postState();
    noPath = 0;
    gaveUp = 0;
    // Flow in vehicles a minute, smoothed over about half a minute.
    for (let k = 0; k < flowCount.length; k++) { flowRate[k] += (flowCount[k] * 60 - flowRate[k]) / 30; flowCount[k] = 0; }
  }
}

setInterval(() => {
  if (speed === 0) return;
  // Keep street-level traffic readable, even when overview fast-forward is selected.
  // Scale the whole simulation so signals, collisions and trip clocks stay aligned.
  for (let s = 0; s < (streetView ? 1 : speed); s++) substep(streetView ? 0.25 : 1);
  writeFrame();
}, 1000 / SIM_HZ);

function applyKind(nk: Uint8Array): void {
  for (let i = 0; i < N_TILES; i++) {
    if (nk[i] !== kind[i]) {
      kind[i] = nk[i];
      level[i] = isService(nk[i]) ? 1 : 0;
      age[i] = 0;
      neglect[i] = 0;
    }
  }
}

self.onmessage = (ev: MessageEvent<MainToWorker>) => {
  const m = ev.data;
  switch (m.type) {
    case 'load': {
      probeStops = []; probeStopIds = []; trafficScale = 1;
      extras = m.extras ? { ...m.extras, district: m.extras.district.slice(), terraform: m.extras.terraform.slice() } : defaultExtras(m.tax);
      baseTerrain = generateTerrain(m.seed);
      terrain = baseTerrain;
      river = new WaterSim(baseTerrain); floodWarning = 0;
      setTerrain();
      garbage.fill(0); disasters.reset();
      disasterRate = m.disasterRate ?? 1;
      riverPollution = new Float32Array(terrain.river.length);
      clearCars();
      segs = [];
      segCong = new Float32Array(0);
      kind.set(m.kind);
      river.reshape(extras.terraform, kind);
      airportClearance = airportClearanceMask(kind, m.rot);
      level.set(m.level);
      age.fill(0);
      neglect.set(m.neglect ?? new Uint8Array(N_TILES));
      funding = { ...defaultFunding(), ...m.funding };
      policies = { ...noPolicies(), ...m.policies };
      effects = policyEffects(policies);
      debt = m.debt ?? 0;
      incidents.load(m.incidents); dispatchCooldown.clear(); robbedSeen = 0; raceUntil = -1;
      // A loaded city starts its own clock: signal phases should not depend on what ran before it.
      simTime = 0;
      inspected = -1;
      post({ type: 'inspection', report: null });
      pollution.fill(0);
      pendingMoveIns = [];
      taxiWindow = 0; taxiStops = []; riderWindow = 0; airWindow = 0; railWindow = 0; tollWindow = 0; airTokens = 0; railTokens = 0; transitSignature = '';
      cityLevel = m.cityLevel;
      money = m.money;
      subCount = 0;
      tick = m.tick;
      tax = m.tax;
      commuteAvg = 0;
      spawnBudget = 0;
      extBudget = 0;
      applyNetwork(m);
      census();
      refreshMaps();
      census();
      postState();
      writeFrame();
      break;
    }
    case 'edit': {
      if (m.district) extras.district.set(m.district);
      if (m.terraform && m.terraform.some((v, i) => v !== extras.terraform[i])) { extras.terraform.set(m.terraform); setTerrain(); }
      applyKind(m.kind);
      river.reshape(extras.terraform, kind);
      airportClearance = airportClearanceMask(kind, m.rot);
      applyNetwork(m);
      money -= m.spent;
      census();
      postState();
      writeFrame();
      break;
    }
    case 'streetView':
      streetView = m.active;
      // Driving thins the traffic to a third; a race clears the streets almost entirely.
      trafficScale = !m.active || !m.driving ? 1 : m.racing ? 0 : 0.35;
      racing = !!(m.active && m.driving && m.racing);
      if (m.active && m.driving) {
        const keep = m.racing ? 0 : 0.35;
        for (let s = 0; s < MAX_CARS; s++) {
          const c = slots[s];
          if (!c) continue;
          // Fire engines at a fire and police at a robbery or a crash carry on; patrols and bin rounds
          // wait for the race to end.
          const urgent = c.mission && (c.mission.kind === 'fire' || c.mission.kind === 'heist' || c.mission.kind === 'crash');
          if (urgent || (!m.racing && (c.mission || c.working))) continue;
          // Outside a race the buses keep running; in one, they go too.
          if (!m.racing && (c.line !== undefined || c.vehicle === 4 || c.vehicle === 8)) continue;
          if (Math.random() > keep) freeCar(s);
        }
      }
      if (!m.active) { player = null; playerLanes.clear(); }
      break;
    case 'player':
      player = m.at;
      locatePlayer();
      break;
    case 'speed':
      speed = m.value;
      break;
    case 'tax':
      tax = clamp(Math.round(m.value), 0, 30);
      extras.taxes = [tax, tax, tax, tax];
      census(); postState();
      break;
    case 'taxes':
      if (!Array.isArray(m.taxes) || m.taxes.length !== 4) break;
      extras.taxes = m.taxes.map(t => clamp(Math.round(t), 0, 30)) as CityExtras['taxes'];
      tax = extras.taxes[0];
      census(); postState();
      break;
    case 'districtPolicy':
      if (!Number.isInteger(m.district) || m.district < 1 || m.district > DISTRICT_COUNT || !Number.isInteger(m.mask) || m.mask < 0 || m.mask >= 1 << DISTRICT_POLICY_IDS.length) break;
      extras.districtPolicies[m.district - 1] = m.mask;
      census(); postState();
      break;
    case 'dayLength':
      if (Number.isFinite(m.seconds) && m.seconds >= 60) dayLength = m.seconds;
      break;
    case 'disasters':
      extras.disasters = !!m.on;
      if (m.rate !== undefined) disasterRate = m.rate;
      if (m.trigger && !disasters.active) disasters.start(m.trigger, disasterContext());
      postState();
      break;
    case 'funding':
      if (!FUNDING_KEYS.includes(m.key) || !validFunding(m.value)) break;
      funding[m.key] = m.value;
      census(); postState();
      break;
    case 'policy':
      if (!isPolicyId(m.id)) break;
      if (m.on && cityLevel < POLICIES[m.id].unlock) {
        post({ type: 'notice', message: `${POLICIES[m.id].label} unlocks at city level ${POLICIES[m.id].unlock + 1}.` });
        break;
      }
      policies[m.id] = m.on;
      effects = policyEffects(policies);
      census(); postState();
      break;
    case 'loan':
      if (m.action === 'take' && debt === 0) {
        money += LOAN_AMOUNT; debt = LOAN_TOTAL;
        post({ type: 'notice', message: '$6,000 received. Repayment: $6/s for 1,100 simulation seconds.' });
      } else if (m.action === 'repay' && debt > 0 && money >= debt) {
        money -= debt; debt = 0;
        post({ type: 'notice', message: 'City loan repaid.' });
      } else post({ type: 'notice', message: debt > 0 ? 'Repay the existing loan before borrowing again. Early repayment needs enough cash.' : 'No outstanding loan.' });
      census(); postState();
      break;
    case 'inspect':
      inspected = Number.isInteger(m.tile) && m.tile >= 0 && m.tile < N_TILES ? m.tile : -1;
      inspectedSeg = inspected >= 0 && typeof m.seg === 'number' ? m.seg : -1;
      postInspection();
      break;
    case 'probe': {
      if (typeof m.walkRate === 'number') { walkRateOverride = m.walkRate; for (const cr of crossings) cr.rate = m.walkRate; }
      const index = new Map(segs.map((s, i) => [s.id, i]));
      if (m.stops) { probeStopIds = m.stops; refreshBusStops(); }
      if (typeof m.trafficScale === 'number') trafficScale = m.trafficScale;
      for (const t of m.trips ?? []) {
        const a = index.get(t.a), b = index.get(t.b);
        if (a !== undefined && b !== undefined) spawnTrip(a, t.as, b, t.bs, t.vehicle ?? 1, undefined, t.callout ? { kind: 'heist', origin: 0, tile: 0, work: 0 } : undefined, undefined, !!t.loop);
      }
      const lanes: Record<number, number[]> = {};
      for (const c of slots) {
        if (!c) continue;
        const id = segs[c.legs[c.li].seg].id;
        (lanes[id] ??= [])[carLane(c)] = ((lanes[id] ??= [])[carLane(c)] ?? 0) + 1;
      }
      // Of the cars near a junction's stop line, how many are in a lane that goes their way.
      let near = 0, right = 0;
      for (const c of slots) {
        if (!c || c.li >= c.legs.length - 1) continue;
        const leg = c.legs[c.li], want = wantedLanes(c);
        if (!want || nodeType[legEndNode(leg)] === J_PLAIN || leg.p1 - c.p > 1.6) continue;
        near++; if (want.includes(c.lane)) right++;
      }
      // Tests may ask after particular cars: where they are, and what the junction ahead is doing.
      const watch = (m.watch ?? []).map(slot => {
        const c = slots[slot];
        if (!c) return null;
        const leg = c.legs[c.li], node = legEndNode(leg), desc = (o: Car | null | undefined): string => o ? `seg${segs[o.legs[o.li].seg].id}${o.legs[o.li].fwd ? 'f' : 'b'} li${o.li}/${o.legs.length} p${o.p.toFixed(2)}/${o.legs[o.li].p1.toFixed(2)} lane${o.lane}>${o.nextLane} box${o.box} ch${o.chT >= 0 ? 1 : 0} stuck${o.stuck.toFixed(1)} v${o.vehicle}` : 'gone';
        return { car: desc(c), node: nodeIds[node], type: nodeType[node], wait: boxWait[node] >= 0 ? `${boxWait[node]}: ${desc(slots[boxWait[node]])}` : '-', box: (boxCars[node] ?? []).map(o => `${o}: ${desc(slots[o])}`), want: wantedLanes(c) };
      });
      // And, when asked, every car's state: its road, how far along, and how fast.
      const detail = m.detail ? slots.flatMap((c, slot) => c ? [{ slot, uid: c.uid, seg: segs[c.legs[c.li].seg].id, fwd: c.legs[c.li].fwd, p: c.p, v: c.v, li: c.li, legs: c.legs.length, vehicle: c.vehicle, lane: c.lane, inBay: !!c.inBay, stuck: c.stuck, flags: signalsOf(c), side: c.side, changing: c.chT >= 0 && c.lane !== c.chLane, box: c.box >= 0 ? nodeIds[c.box] : -1, lock: c.lock >= 0 ? nodeIds[c.lock] : -1, insistent: c.insistent, x: trafficSpace.poses.get(slot)?.x ?? 0, z: trafficSpace.poses.get(slot)?.z ?? 0, angle: trafficSpace.poses.get(slot)?.angle ?? 0 }] : []) : undefined;
      const walkers = m.detail ? walkerFrame() : undefined;
      // Every car's route still joins up, leg to leg, after any rerouting.
      let broken = 0;
      for (const c of slots) if (c) for (let k = 0; k + 1 < c.legs.length; k++) {
        const a = c.legs[k], b = c.legs[k + 1];
        if (legEndNode(a) !== legStart(b) && !(ringArc[a.seg] || ringArc[b.seg]) && a.seg !== b.seg) broken++;
      }
      post({ type: 'probe', arrived: arrivedTotal, gaveUp: gaveUpTotal, cars: activeCars, lanes, nearLine: near, rightLane: right, trips: Object.fromEntries(arrivedBy), watch, signalAdmits: { ...sigAdmits }, detail, walkers, reroutes, broken } as never);
      break;
    }
    case 'warm': {
      commuteAvg = 0;
      for (let n = 0; n < m.ticks; n++) { spreadPollution(); census(); refreshMaps(); grow(); }
      pendingMoveIns = [];
      census();
      postState();
      break;
    }
  }
};


/** Explain the same local requirements used by growth, without duplicating the simulation in the UI. */
function postInspection(): void {
  if (inspected < 0) { post({ type: 'inspection', report: null }); return; }
  if (inspectedSeg >= 0) {
    const report = roadReport(inspectedSeg, inspected);
    if (report) { post({ type: 'inspection', report }); return; }
    inspectedSeg = -1;
  }
  const i = inspected, k = kind[i], l = level[i], spec = SERVICES[k];
  const report: TileReport = {
    tile: i, name: spec?.name ?? (ZONE_NAMES[k] ?? (terrain.water[i] ? 'River' : cover[i] ? 'Road' : 'Unzoned land')),
    level: l, occupants: zoneOccupants(k, l),
    status: 'Ready to zone or build', details: [], blockers: [], coverage: {}, neglect: neglect[i],
  };
  const f = flags[i];
  if (spec?.decoration) report.details.push(parkReach[i] ? 'Accessible from a road or connected park path' : 'Join paths, plazas or lawns to a connected road to activate recreation benefits');
  if (isZone(k) || spec) {
    for (const [flag, message] of [[F_NO_ROAD, 'Connect this building to the highway'], [F_NO_POWER, 'Restore electricity'], [F_NO_WATER, 'Restore water supply'], [F_NO_SEWAGE, 'Restore sewage capacity']] as const) if (f & flag) report.blockers.push(spec?.decoration && flag === F_NO_ROAD ? 'Connect this amenity to a road or park path' : message);
    if (incidents.fires.has(i)) report.blockers.push(`Building on fire: ${120 - incidents.fires.get(i)!.age}s before damage. Needs a responding fire engine.`);
    if (!spec?.decoration) report.details.push(`Crime pressure: ${Math.round(incidents.crime[i])}% · patrol protection: ${Math.ceil(incidents.patrol[i])}s`);
    report.details.push(`Ground pollution: ${pollution[i].toFixed(1)}`);
    report.details.push(`Land value: ${Math.round(landValue[i])} · noise ${Math.round(noise[i])} · rubbish ${Math.round(garbage[i])}%`);
    if (isZone(k)) report.details.push(`Tax rate here: ${taxAt(i)}%`);
    if (extras.district[i]) report.details.push(`District ${extras.district[i]}`);
  }
  if (isZone(k)) {
    if (airportClearance[i]) report.blockers.push('Airport runway clearance: no new construction or building upgrades');
    report.status = l === 0 ? 'Waiting for construction' : l === 3 ? 'Maximum building level' : `Level ${l} → ${l + 1}`;
    if (zoneDemand(k) <= 0 && l < 3) report.blockers.push('Demand is too low: balance homes, jobs and taxes');
    if (k === T_RES) {
      for (const key of Object.keys(CIVIC_LABELS) as CivicNeed[]) report.coverage[key] = Math.round(civicState.coverage[key][i] * 100);
      if (l > 0 && l < 3) report.blockers.push(...civicShortfalls(i, l + 1, cityLevel, civicState.coverage));
      if (pollution[i] >= (l ? 3 : 6)) report.blockers.push('Move polluting industry away from homes');
      if (neglect[i]) {
        report.status = `Service decline: ${NEGLECT_LIMIT - neglect[i]}s to downgrade`;
        report.blockers.push(...civicShortfalls(i, l, cityLevel, civicState.coverage, true));
      }
    }
    if (k === T_OFFICE && l > 0 && l < 3 && civicState.average.education < (l === 1 ? 25 : 50)) report.blockers.push(`Offices need ${l === 1 ? 25 : 50}% city education coverage to upgrade`);
    if (k === T_OFFICE && l === 2 && (cityLevel < 4 || landValue[i] < 45)) report.blockers.push('Office towers need a City (1,800 residents) and a land value of 45');
    if (l === 2 && cityLevel < 3) report.blockers.push('High-rises unlock at Thriving town (900 residents)');
    if (l === 2 && zoneBase(k) !== T_IND && landValue[i] < 30) report.blockers.push(`Land value ${Math.round(landValue[i])} / 30: parks, transit, a river view and quiet streets raise it`);
    if (districtPolicy(i, 'highriseBan') && l >= 2) report.blockers.push('This district has a high-rise ban');
    if (garbage[i] > 60) report.blockers.push('Rubbish is piling up: a recycling centre sends trucks to collect it');
    { const need = k === T_OFFICE ? (l === 1 ? 30 : 75) : l === 1 ? 10 : 22; if (l > 0 && l < 3 && age[i] <= need) report.blockers.push(`Maturing: ${need + 1 - age[i]}s remaining`); }
    if (l < 3 && report.blockers.length === 0) report.details.push('Eligible for growth; construction occurs gradually.');
    report.details.push(`Zone demand: ${Math.round(zoneDemand(k) * 100)}%`);
    if (k === T_LEISURE && l > 0) report.details.push(`Visitor appeal: ×${tourismAppeal(i).toFixed(2)} (parks and waterfront raise it)`);
    if (k === T_LEISURE && cityLevel < LEISURE_UNLOCK) report.blockers.push('Leisure & tourism opens at Small town (400 residents)');
  } else if (spec) {
    const budget = serviceFunding(spec, funding);
    const efficiency = spec.civic ? civicEfficiency(i) : f ? 0 : fundingOutput(budget);
    report.status = efficiency > 0 ? 'Operating' : 'Not operating';
    report.details.push(`Funding: ${Math.round(budget * 100)}% · upkeep $${(spec.upkeep * budget).toFixed(2)}/s`);
    if (spec.civic) report.details.push(`Effective capacity: ${Math.round(spec.capacity! * efficiency)} residents · range ${spec.radius} cells`, 'Needs 3 power and 2 water; congestion can reduce capacity by up to 50%.');
    else if (spec.transport) {
      const lines = transit.lines.filter(line => line.a === i || line.b === i);
      report.details.push(spec.transport === 'taxi' ? `${slots.filter(car => car?.taxiStop === i).length} of 4 taxis carrying passengers · ${spec.radius}-cell walking catchment` : spec.transport === 'air' ? 'Regional flights replace some incoming road trips within 24 cells. Needs power, water and sewage.' : `${lines.length} active automatic connections · ${spec.radius}-cell walking catchment`);
      if (spec.transport !== 'air' && spec.transport !== 'taxi' && !lines.length) report.blockers.push('Add a second operating stop or station; bus stops need a road route in both directions');
      if (spec.transport === 'taxi') report.details.push('Works with a single stop. Passengers walk here and take a taxi directly to their destination; four cabs can operate at once. Traffic slows trips. Fares are earned on arrival. Needs power, water and sewage.');
      if (spec.transport === 'trolley') report.details.push('40 passenger capacity per connection; electric trolleybuses depart automatically on wired surface streets and avenues. Needs power, water and sewage.');
      if (spec.transport === 'bus') report.details.push('30 passenger capacity per connection; traffic slows service. Buses depart automatically.');
      if (spec.transport === 'subway') report.details.push('100 passenger capacity per connection; underground tunnels link metro stations automatically, unaffected by traffic.');
      if (spec.transport === 'rail') report.details.push('120 passenger capacity per connection; elevated tracks connect stations automatically.');
    } else report.details.push(`Capacity: ${Math.round((spec.power || spec.water || spec.sewage) * efficiency)} ${spec.power ? 'power' : spec.water ? 'water' : 'sewage'}`);
  }
  if (k === T_POLICE_HQ) report.details.push('Runs two patrol cars at once across a wider district, and answers robberies first.');
  if (k === T_POLICE) report.details.push('Dispatches patrol cars to nearby buildings. Completed visits deter crime for three minutes; cars also respond to collisions.');
  if (k === T_FIRE) report.details.push('Dispatches one fire engine at a time to reachable fires. After arrival, firefighting takes eight seconds.');
  if (spec?.treatment) report.details.push('Filters 95% of effluent with full electricity. Power shortages reduce filtration.');
  report.blockers = [...new Set(report.blockers)];
  post({ type: 'inspection', report });
}
