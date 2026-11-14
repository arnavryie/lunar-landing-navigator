import { DEFAULT_ROVER_CONFIG } from '../src/lander/types.ts'
import { kmBetween, bearingDeg, cardinalDirection } from '../src/lander/engine/mapLoader.ts'
import { calculateSolarIncidenceCosine, calculateSolarOutputWatts } from '../src/lander/engine/solarModel.ts'

console.log('--- Testing Lunar Solar Recharge Planner Engine ---')

// 1. Solar model test
const cosInc = calculateSolarIncidenceCosine(DEFAULT_ROVER_CONFIG.solar, 1.2, 45)
console.log('Solar incidence cosine (1.2 deg sun, 80 deg tilt):', cosInc.toFixed(4))
if (cosInc <= 0.8 || cosInc > 1.0) throw new Error('Invalid solar incidence cosine')

const solarWatts = calculateSolarOutputWatts(DEFAULT_ROVER_CONFIG.solar, 1.2, 45, 1.0)
console.log('Solar generation output:', solarWatts.toFixed(1), 'W (rated 480W)')
if (solarWatts < 300 || solarWatts > 550) throw new Error('Unexpected solar wattage')

// 2. Spatial calculations
const d = kmBetween(-89.5, 0, -89.5, 90)
console.log('Distance between -89.5, 0 and -89.5, 90:', d.toFixed(2), 'km')
const b = bearingDeg(-89.5, 0, -89.5, 90)
console.log('Bearing:', b.toFixed(1), 'deg ->', cardinalDirection(b))

console.log('Core Solar & Kinematic Calculations PASSED!')
