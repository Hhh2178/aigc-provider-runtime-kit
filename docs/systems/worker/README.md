# Worker Integration System

This project does not ship a queue worker in v0.1.

Host applications should provide:

- queue storage
- retry policy
- cancellation
- result materialization
- observability

This kit provides RunningHub client and key-pool primitives that workers can call.
