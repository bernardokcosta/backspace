# Federation retirement

Federation is not supported. Peer handshakes, signed relay, remote identities,
replication workers and peer administration have been removed, not disabled.
There is no compatibility endpoint, peering configuration or reconnect path.

The generated 0049/0050 upgrade removes exclusive remote state while preserving
native accounts, credentials, content, files and settings. It takes a snapshot,
classifies old ownership, refuses ambiguous dependencies, verifies native rows
and commits atomically. Only proven retired files are eligible for targeted
postcommit cleanup. Never reset the instance to upgrade. See
[database.md](database.md) for refusal/recovery and migration invariants.

Historical protocol specifications and generated migration history are retained
as exact inventoried evidence, not current APIs. Native contracts are documented
in [auth.md](auth.md), [dm-system.md](dm-system.md), [social.md](social.md),
[websocket.md](websocket.md) and [client-federation.md](client-federation.md).
