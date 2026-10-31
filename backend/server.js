const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// POST /api/simulate
app.post('/api/simulate', (req, res) => {
  const { trafficDensity, intersections, pedestrianBuffer } = req.body;

  // --- Input Validation ---
  if (!trafficDensity || intersections == null || pedestrianBuffer == null) {
    return res.status(400).json({ error: 'Missing required fields: trafficDensity, intersections, pedestrianBuffer.' });
  }
  if (!['Low', 'Medium', 'Heavy'].includes(trafficDensity)) {
    return res.status(400).json({ error: 'trafficDensity must be "Low", "Medium", or "Heavy".' });
  }
  if (typeof intersections !== 'number' || intersections < 1) {
    return res.status(400).json({ error: 'intersections must be a positive number.' });
  }
  if (typeof pedestrianBuffer !== 'number' || pedestrianBuffer < 0) {
    return res.status(400).json({ error: 'pedestrianBuffer must be a non-negative number.' });
  }

  // --- Simulation Math ---

  // Base time per intersection (seconds)
  const baseTransitTime = 15;

  // Normal red-light wait per intersection (seconds)
  const normalRedWait = 45;

  // Density multiplier based on traffic level
  const densityMultiplier = trafficDensity === 'Heavy' ? 3.5
    : trafficDensity === 'Medium' ? 2.0
    : 1.0;

  // Normal travel time: base transit + red-wait adjusted for density
  const normalTravelTime =
    (intersections * baseTransitTime) +
    (intersections * normalRedWait * densityMultiplier);

  // Emergency clearance phase per intersection:
  // 3s Yellow + 2s All-Red interlock + pedestrian buffer
  const clearancePhaseTime = 3 + 2 + pedestrianBuffer;

  // Emergency travel time: base transit + clearance phase only (no red-wait)
  const emergencyTravelTime =
    (intersections * baseTransitTime) +
    (intersections * clearancePhaseTime);

  // Time and percentage saved
  const timeSavedSeconds = normalTravelTime - emergencyTravelTime;
  const percentageSaved = ((timeSavedSeconds / normalTravelTime) * 100).toFixed(2);

  // --- Safeguard Log Generation ---
  const safeguardLog = [];
  for (let i = 1; i <= intersections; i++) {
    safeguardLog.push(
      `[NODE ${i}] Cross-traffic forced YELLOW (3s) -> ` +
      `[NODE ${i}] Pedestrian clearance active (${pedestrianBuffer}s buffer) -> ` +
      `[NODE ${i}] ALL-RED interlock (2s) -> ` +
      `[NODE ${i}] GREEN CORRIDOR established.`
    );
  }

  // --- Response ---
  return res.status(200).json({
    normalTravelTime,
    emergencyTravelTime,
    timeSavedSeconds,
    percentageSaved: parseFloat(percentageSaved),
    safeguardLog,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Emergency Corridor Simulation server running at http://localhost:${PORT}`);
});

