/**
 * Level definitions. All positions are NORMALIZED to [-1, 1] and multiplied by the
 * current play half-extent at load time, so layouts stay on-screen at any aspect.
 *
 * Fields:
 *   duck        : [x, y]              player duck start
 *   ducklings   : [[x, y], ...]       collectibles (gather all to open the goal)
 *   goal        : [x, y]              home ring
 *   drains      : [[x, y], ...]       hazards that pull the duck in (avoid)
 *   obstacles   : [[x, y], ...]       floating beach balls (bounce off)
 *   parStrokes  : number              ripples used for 3★
 *   parTime     : seconds             time for 3★
 *   tip         : string              one-line hint shown briefly
 */
export const LEVELS = [
  {
    name: 'First Splash',
    duck: [-0.6, 0.0],
    ducklings: [[0.15, 0.25]],
    goal: [0.7, -0.3],
    drains: [],
    obstacles: [],
    parStrokes: 14,
    parTime: 25,
    tip: 'Tap just AHEAD of the duck — it drifts toward your ripples.',
  },
  {
    name: 'Two to Gather',
    duck: [0.0, -0.7],
    ducklings: [[-0.7, 0.3], [0.7, 0.35]],
    goal: [0.0, 0.75],
    drains: [],
    obstacles: [],
    parStrokes: 24,
    parTime: 45,
    tip: 'Short ripples steer; big ripples shove.',
  },
  {
    name: 'Beach Ball Alley',
    duck: [-0.8, -0.6],
    ducklings: [[0.0, 0.0], [0.75, -0.6], [-0.6, 0.7]],
    goal: [0.8, 0.7],
    drains: [],
    obstacles: [[0.3, -0.45], [-0.2, 0.45]],
    parStrokes: 36,
    parTime: 70,
    tip: 'Beach balls bounce the duck — use them or avoid them.',
  },
  {
    name: 'Mind the Drain',
    duck: [-0.8, 0.0],
    ducklings: [[0.0, 0.7], [0.0, -0.7], [0.8, 0.0]],
    goal: [0.85, -0.7],
    drains: [[0.15, 0.0]],
    obstacles: [],
    parStrokes: 42,
    parTime: 80,
    tip: 'The drain pulls you in. Skirt around it.',
  },
  {
    name: 'Whirlpool Rescue',
    duck: [0.0, -0.85],
    ducklings: [[-0.8, 0.0], [0.8, 0.0], [-0.5, 0.75], [0.5, 0.75]],
    goal: [0.0, 0.9],
    drains: [[-0.35, 0.4], [0.4, -0.3]],
    obstacles: [[0.0, 0.2]],
    parStrokes: 56,
    parTime: 120,
    tip: 'Two drains and a ball. Plan each push.',
  },
];
