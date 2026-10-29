# Live chat eval (router)

- Dataset chat-v1, model claude-haiku-5-5, 6 runs, 2026-10-29T07:14:55.412Z
- Passed 6/6
- Anthropic HTTP calls 2, tokens in 15378 / out 1463, web searches 2, estimated cost $0.0223 (list prices, src/cost.ts)
- Median latency 1389 ms

| case | kind | result | route | ms | notes |
| --- | --- | --- | --- | --- | --- |
| grounded-price | grounding | pass | apple | 1389 |  |
| grounded-price | grounding | pass | apple | 773 |  |
| simple-math | local | pass | apple | 1136 |  |
| simple-math | local | pass | apple | 1331 |  |
| current-info | escalation | pass | key | 5816 |  |
| current-info | escalation | pass | key | 4290 |  |
