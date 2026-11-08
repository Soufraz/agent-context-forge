| Benchmark | Pairs | Correct (base / harness) | Metric | Baseline mean | Harness mean | Change | 90% CI of change | Harness lower in |
|---|---|---|---|---|---|---|---|---|
| 01-lockfile-tanstack-query | 6 | 6 / 6 | Cost | $0.048 | $0.058 | +22% | +16% to +30% | 0/6 |
|  |  |  | Peak context | 20,795 | 21,264 | +2% | +1% to +3% | 0/6 |
|  |  |  | Tool output | 2,701 | 2,467 | -7% | -20% to +7% | 4/6 |
| 02-test-output-click | 6 | 6 / 6 | Cost | $0.064 | $0.064 | +2% | -6% to +11% | 3/6 |
|  |  |  | Peak context | 22,265 | 21,793 | -2% | -4% to -0% | 5/6 |
|  |  |  | Tool output | 7,708 | 5,655 | -25% | -37% to -11% | 5/6 |
| 02-test-output-click@haiku | 6 | 6 / 6 | Cost | $0.007 | $0.006 | -9% | -33% to +16% | 3/6 |
|  |  |  | Peak context | 30,793 | 28,054 | -8% | -14% to -3% | 5/6 |
|  |  |  | Tool output | 17,123 | 12,861 | -24% | -35% to -14% | 5/6 |
| 03-exploration-gin | 6 | 6 / 6 | Cost | $0.134 | $0.129 | -0% | -12% to +10% | 3/6 |
|  |  |  | Peak context | 30,249 | 29,746 | -1% | -6% to +3% | 3/6 |
|  |  |  | Tool output | 23,483 | 21,541 | -5% | -19% to +9% | 3/6 |
| 04-lsp-date-fns | 6 | 0 / 2 | Cost | $0.060 | $0.089 | +49% | +38% to +58% | 0/6 |
|  |  |  | Peak context | 22,184 | 25,456 | +15% | +10% to +20% | 0/6 |
|  |  |  | Tool output | 5,531 | 7,185 | +30% | -7% to +69% | 3/6 |
| 04-lsp-date-fns@haiku | 6 | 0 / 0 | Cost | $0.004 | $0.006 | +51% | +34% to +68% | 0/6 |
|  |  |  | Peak context | 24,317 | 27,424 | +13% | +9% to +17% | 0/6 |
|  |  |  | Tool output | 6,738 | 7,573 | +17% | -5% to +40% | 2/6 |
| 07-long-session-click | 6 | 6 / 6 | Cost | $0.212 | $0.207 | -1% | -8% to +4% | 2/6 |
|  |  |  | Peak context | 37,278 | 36,521 | -2% | -5% to +1% | 4/6 |
|  |  |  | Tool output | 28,230 | 24,040 | -14% | -25% to -4% | 5/6 |
| 07-long-session-click@haiku | 6 | 6 / 6 | Cost | $0.023 | $0.024 | +6% | -6% to +16% | 2/6 |
|  |  |  | Peak context | 58,930 | 59,787 | +3% | -9% to +14% | 2/6 |
|  |  |  | Tool output | 62,508 | 62,190 | +7% | -21% to +35% | 3/6 |
