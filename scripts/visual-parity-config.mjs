export const FINAL_TECHNICAL_VISUAL_PARITY_POLICY = Object.freeze({
  status: "final-technical-regression-thresholds",
  finalThresholds: true,
  scope: "technical-regression-only",
  evidenceMetricTolerance: Object.freeze({
    scope: "recorded-metric-comparison-only",
    phashAbsolute: 0.001,
    nccAbsolute: 0.000001
  }),
  views: Object.freeze({
    entry: Object.freeze({ phashMax: 14, nccMin: 0.62 }),
    workspace: Object.freeze({ phashMax: 25, nccMin: 0.68 }),
    reading: Object.freeze({ phashMax: 32, nccMin: 0.45 }),
    "diagonal-overview": Object.freeze({ phashMax: 135, nccMin: 0.22 })
  }),
  aggregate: Object.freeze({ phashTotalMax: 195, nccMeanMin: 0.5 })
});
