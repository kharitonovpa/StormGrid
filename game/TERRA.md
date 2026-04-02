You are a senior gameplay engineer and technical 3D systems architect.

I am building a **3D game map system** in **TypeScript + Three.js**.

Your task is to design and partially implement a **hybrid terrain architecture** where:

* the **gameplay logic** lives on a hidden **7×7 sector grid**
* the **visual terrain** is rendered as a **single smooth continuous surface**
* the terrain must **not** look like Minecraft blocks or stepped cubes
* the terrain must feel like a soft continuous surface, almost like a **blanket draped over a structured base**
* however, the gameplay must remain **discrete, predictable, and controllable**

## Very important gameplay condition

The map is **initially completely flat**.

The landscape is **not pre-authored** at start.

Instead, **players change the terrain during gameplay**.

That means:

* at the beginning, all sectors are flat / neutral
* during the match, players can decide that specific sectors become:

    * elevated
    * depressed
    * or remain flat
* terrain changes happen **at runtime**
* the system must support **updating the terrain dynamically**
* the resulting terrain should still remain visually smooth and coherent after many changes

So this is **not just terrain generation**.
This is a **runtime terrain deformation system driven by sector state changes**.

---

## Core design goal

I want a system where:

* gameplay uses a hidden sector model
* visuals use a smooth terrain mesh
* players modify sector states over time
* the map gradually evolves from a flat board into a shaped landscape
* terrain changes must be readable and fair for gameplay
* visual smoothing must not destroy gameplay truth

In other words:

**Discrete sector-based gameplay, continuous smooth terrain rendering, runtime player-driven deformation.**

---

## Hard constraints

1. Do **not** propose pure voxel/block geometry.
2. Do **not** propose abandoning the hidden sector grid.
3. Do **not** treat this as static terrain only.
4. The solution must explicitly support **runtime terrain updates**.
5. The solution must be suitable for a **real game**, not just a visual procedural demo.
6. Terrain must begin as flat and evolve over time through player actions.
7. Visual noise/deformation must never make gameplay ambiguous.

---

## Map model

Base assumptions:

* map is rectangular
* map is divided into **7×7 equal sectors**
* each sector has a world size like `3n` or `4n`
* the whole map has thickness `n`
* initially all sectors are flat
* later, sectors can become:

    * `plain`
    * `elevation`
    * `depression`

You may expand this model if useful, for example:

* deformation strength
* transition softness
* locked terrain
* terrain ownership
* terrain history
* runtime animation state

---

## What I want from you

Give me a **practical engineering design**, not abstract theory.

Structure the response into the following sections.

---

# 1. Recommended architecture

Design the system in layers.

At minimum include:

## A. Gameplay Grid Layer

Responsible for:

* hidden 7×7 logic grid
* sector coordinates
* sector state
* traversability
* gameplay modifiers
* height level or terrain intent
* runtime terrain edit requests coming from player actions

## B. Terrain State / Deformation Layer

Responsible for:

* storing current terrain deformation data
* converting sector states into deformable height targets
* blending neighboring sectors
* supporting runtime updates
* deciding whether terrain rebuild is immediate, animated, incremental, cached, or full recompute

## C. Terrain Mesh Layer

Responsible for:

* building and updating one continuous terrain mesh
* keeping smooth transitions
* recomputing vertex heights
* normals update
* map thickness / underside / side walls if needed

## D. Gameplay-Visual Sync Layer

Responsible for:

* ensuring rendered terrain matches gameplay truth
* mapping world position to sector
* mapping sector state to visual height
* preventing ambiguity caused by smoothing or noise

## E. Debug Layer

Responsible for:

* hidden grid overlay
* sector state visualization
* height visualization
* slope debug
* rebuild/update debug

Explain why this architecture is better than:

* pure block/cell geometry
* fully continuous terrain with no hidden logic grid

---

# 2. Data model in TypeScript

Design robust TypeScript types/interfaces.

At minimum include:

* `SectorType`
* `SectorCoord`
* `SectorRuntimeState`
* `GridMapData`
* `TerrainDeformationState`
* `TerrainBuildOptions`
* `TerrainUpdateRequest`
* `HeightSample`
* `TerrainRuntimeConfig`

`SectorRuntimeState` should include fields such as:

* coordinate
* current type
* target type
* current logical height
* target logical height
* transition softness
* local deformation amplitude
* traversability
* gameplay tags
* whether it is currently animating
* owner/source of modification if useful

`TerrainUpdateRequest` should describe runtime change initiated by gameplay, for example:

* player action
* target sector
* desired new terrain state
* intensity
* whether to animate
* duration

Use clean naming and realistic structures.

---

# 3. Terrain deformation algorithm

Describe the **runtime-friendly algorithm** step by step.

You must cover:

## Initial state

* all sectors start flat
* terrain mesh starts flat

## Runtime change flow

When a player changes one sector:

1. gameplay grid receives sector change
2. logical sector state updates
3. terrain deformation target updates
4. visual terrain recalculates
5. mesh updates
6. normals refresh
7. optional animation interpolates old shape to new shape

## Height calculation

For each terrain vertex, explain:

* how to determine its primary sector
* how neighboring sectors influence it
* how to blend multiple sector influences
* how to preserve sector readability
* how to avoid visible hard steps
* how to avoid over-smoothing away gameplay meaning

## Runtime update strategy

Compare these options:

* full mesh rebuild
* vertex-only height updates
* chunk/local region recompute
* dirty sector propagation
* cached influence fields

Then recommend one.

## Blending methods

Evaluate and choose between:

* bilinear interpolation
* smoothstep-based blending
* radial falloff
* gaussian influence
* bezier-like shaping
* layered noise
* multi-octave noise
* domain warping

I want you to explicitly recommend a practical combination for a game like this.

## Important

The system must work well when:

* one sector changes
* several adjacent sectors change
* players repeatedly reshape terrain over time
* map evolves from fully flat to varied terrain

---

# 4. Three.js + TypeScript implementation skeleton

Provide a realistic code skeleton, not vague pseudocode.

I want a practical starting point using:

* `BufferGeometry`
* typed arrays
* clean helper functions
* minimal but real architecture

Include at least:

* `createFlatGridMap(...)`
* `requestSectorTerrainChange(...)`
* `applyTerrainUpdate(...)`
* `buildTerrainGeometry(...)`
* `updateTerrainGeometryHeights(...)`
* `sampleTerrainHeightAtWorld(...)`
* `getSectorAtWorldPosition(...)`
* `recalculateNormals(...)`
* `computeDirtyRegionFromSectorChange(...)`

If useful, also include:

* `animateTerrainTransition(...)`
* `sampleSectorInfluence(...)`
* `blendSectorHeights(...)`

The code should reflect:

* flat initial state
* runtime changes from player actions
* sector-driven deformation
* smooth visual transitions
* gameplay-safe logic separation

---

# 5. Gameplay integration rules

Explain how gameplay should interact with deformable terrain.

Cover:

* how a character knows which sector they are in
* whether movement cost is determined by logical sector or rendered slope
* how height bonus should be calculated
* how line of sight should work
* how pathfinding should work
* how terrain changes during gameplay affect units already standing nearby
* how to avoid unfairness when visual mesh is smoother than logical rules
* whether gameplay should use:

    * logical height only
    * sampled mesh height only
    * or hybrid interpretation

State a clear rule:

**Gameplay truth must come from the logical model first, while rendered mesh is a visualized continuous interpretation of that model.**

Also explain where sampled mesh height is still useful:

* foot placement
* animation
* VFX placement
* projectile visuals
* decals

---

# 6. Runtime update and performance strategy

This part is very important.

The system must support repeated player-driven terrain changes.

Explain:

* what should be recalculated on every terrain change
* what can be cached
* how to track dirty sectors
* how many neighboring sectors should be included in recompute
* how to avoid rebuilding unrelated vertices
* when full rebuild is acceptable
* when partial update is better

Mention likely bottlenecks:

* vertex updates
* normal recomputation
* frequent animation updates
* repeated terrain edits in one turn/second

Give a recommended strategy for:

* MVP
* scalable version
* future advanced optimization

---

# 7. Edge cases

I want you to explicitly list edge cases and how to handle them.

For example:

* repeated toggling of the same sector
* adjacent elevation and depression with extreme contrast
* terrain changes at map border
* multiple simultaneous player terrain edits
* unit standing on sector while it deforms
* visual artifacts after many updates
* smoothing causing mismatch with gameplay interpretation

---

# 8. Development roadmap

Give a roadmap in 3 stages.

## MVP

* flat map start
* 7×7 hidden grid
* 3 sector states
* single smooth terrain mesh
* sector change causes runtime terrain update
* simple debug overlay

## Mid stage

* animated terrain transitions
* dirty region updates
* better material blending
* terrain debug tools
* gameplay hooks

## Advanced

* local brushes within sector
* erosion-like shaping
* hard-edge/cliff mode for special abilities
* baked nav helpers
* per-sector visual themes
* networking/replication considerations if useful

---

# 9. Final recommendation

At the end, provide:

1. **Recommended architecture**
2. **Recommended runtime update strategy**
3. **Recommended height blending algorithm**
4. **Minimum class/function set to implement first**
5. **What I should build first in Cursor step-by-step**

---

## Output style requirements

* Be concrete
* Be technical
* Be implementation-oriented
* No fluff
* Use TypeScript examples
* Explain trade-offs
* Optimize for actual game development
* Prefer maintainable code over overly clever math
* Assume this will be implemented incrementally in a real project

Also, if useful, propose a small class/module layout such as:

* `grid-map.ts`
* `terrain-state.ts`
* `terrain-geometry.ts`
* `terrain-runtime.ts`
* `terrain-debug.ts`

Do not give me only theory.
I want a design that can directly guide implementation in Cursor.
