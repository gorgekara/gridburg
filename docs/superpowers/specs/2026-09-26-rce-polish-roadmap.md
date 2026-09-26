# Polish for a civil engineer's eye: roadmap

The goal is a game a real civil engineer (RealCivilEngineer) would enjoy picking apart and find mostly
right. The traffic now behaves like traffic: IDM drivers, gap acceptance, realistic capacities. What
remains is that too little of it can be *seen*, and a few things real roads do are missing.

Decided: all five phases, in this order. Each gets its own spec, is built on branch `rce-polish`,
tested, reviewed independently and verified before the next.

| Phase | What | Why first |
|---|---|---|
| A | Paint and signs: stop lines where cars really stop, give-way markings and yield signs, solid lines on junction approaches, per-lane signal heads with flashing-yellow turn arrows, an all-red interval, hatched gores, curve chevrons, speed signs that match the simulation | The most visible, and it makes priority and signal behaviour readable |
| B | Vehicles that communicate: brake lights from real braking, indicators, emergency lights and pulling over, no visible vanishing | Behaviour a viewer reads at a glance |
| C | Pedestrians as traffic: crossing on the zebras, turning cars yielding to them, pedestrian signal phases, curb ramps | The biggest missing road user |
| D | Junction geometry: roundabouts with splitter islands and multi-lane gap acceptance, raised avenue medians with turn bays, channelised right turns, motorway barriers and shoulders | Deeper simulation changes |
| E | Transit and demand: bus bays and dwell times, bus lanes, peak hours with return trips, better route choice | The city around the roads |
