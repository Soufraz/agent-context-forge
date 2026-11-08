| Benchmark | Pairs | Correct (base / harness) | Metric | Baseline mean | Harness mean | Change | 90% CI of change | Harness lower in |
|---|---|---|---|---|---|---|---|---|
| 01-lockfile-tanstack-query | 6 | 6 / 6 | Cost | $0.047 | $0.057 | +23% | +12% to +34% | 0/6 |
|  |  |  | Peak context | 20,510 | 21,259 | +4% | +3% to +4% | 0/6 |
|  |  |  | Tool output | 2,265 | 2,468 | +11% | -4% to +25% | 2/6 |
| 02-test-output-click | 6 | 5 / 6 | Cost | $0.062 | $0.055 | -10% | -18% to -3% | 4/6 |
|  |  |  | Peak context | 22,845 | 21,641 | -5% | -7% to -3% | 6/6 |
|  |  |  | Tool output | 8,743 | 5,702 | -34% | -43% to -24% | 6/6 |
| 02-test-output-click@haiku | 6 | 6 / 6 | Cost | $0.011 | $0.007 | -35% | -53% to -9% | 5/6 |
|  |  |  | Peak context | 34,113 | 28,842 | -15% | -23% to -6% | 5/6 |
|  |  |  | Tool output | 18,970 | 12,800 | -31% | -43% to -18% | 5/6 |
| 03-exploration-gin | 6 | 6 / 6 | Cost | $0.138 | $0.121 | -12% | -18% to -6% | 6/6 |
|  |  |  | Peak context | 29,951 | 28,711 | -4% | -8% to +0% | 4/6 |
|  |  |  | Tool output | 22,603 | 19,466 | -14% | -26% to -1% | 5/6 |
| 04-lsp-date-fns | 6 | 0 / 3 | Cost | $0.057 | $0.085 | +49% | +40% to +58% | 0/6 |
|  |  |  | Peak context | 22,132 | 24,492 | +11% | +8% to +13% | 0/6 |
|  |  |  | Tool output | 5,196 | 5,337 | +5% | -16% to +25% | 3/6 |
| 04-lsp-date-fns@haiku | 6 | 0 / 0 | Cost | $0.005 | $0.006 | +21% | +5% to +39% | 1/6 |
|  |  |  | Peak context | 25,728 | 26,677 | +4% | -1% to +8% | 2/6 |
|  |  |  | Tool output | 8,930 | 6,326 | -28% | -38% to -19% | 6/6 |
| 07-long-session-click | 6 | 6 / 6 | Cost | $0.217 | $0.222 | +3% | -7% to +12% | 3/6 |
|  |  |  | Peak context | 38,598 | 37,644 | -2% | -8% to +4% | 3/6 |
|  |  |  | Tool output | 30,391 | 25,950 | -12% | -29% to +7% | 5/6 |
| 07-long-session-click@haiku | 6 | 6 / 6 | Cost | $0.029 | $0.026 | -7% | -21% to +7% | 3/6 |
|  |  |  | Peak context | 69,969 | 63,169 | -7% | -23% to +7% | 3/6 |
|  |  |  | Tool output | 85,312 | 66,109 | -12% | -40% to +16% | 3/6 |
