# Infra

Redis in all three connection modes, each with its own RedisInsight already connected.

| Mode | Redis | RedisInsight | Compose project |
| --- | --- | --- | --- |
| standalone | 6379 | http://localhost:5542 | `showcase-standalone` |
| sentinel | master 6380, replica 6381, sentinels 26379–26381 (`mymaster`) | http://localhost:5541 | `showcase-sentinel` |
| cluster | 7001–7003 | http://localhost:5540 | `showcase-cluster` |

## Scripts

Run from the repo root. The `infra:*` scripts take an optional `:<mode>` suffix (`standalone`, `sentinel`, `cluster`); without it, they run for all three modes in turn.

- `pnpm infra:up`: starts Redis and RedisInsight (`up -d --wait`) and returns once every stack is usable.
- `pnpm infra:stop`: stops the containers and keeps the data.
- `pnpm infra:down`: removes the containers and their volumes (`down -v`), so the next start is empty.
- `pnpm redis:<mode>`: opens `redis-cli` inside the stack, passing extra arguments through, e.g. `pnpm redis:cluster GET showcase:cache:a`. Run `infra:up` first: on a stopped stack, `run` starts Redis without waiting for it to be ready. Standalone connects to 6379, cluster to 7001 (`-c`), and sentinel to sentinel 26379; to reach a data node there, use `pnpm redis:sentinel -p 6380`.

All of them go through `scripts/compose.mjs`, which passes the mode's project name and both compose files. Each stack needs its own project name: from one folder, the three files would otherwise all be project `infra` and remove each other's containers as orphans.

## Upstream compose files

`standalone.compose.yml`, `sentinel.compose.yml` and `cluster.compose.yml` are byte-identical copies of `docker/*.compose.yml` in [`org-utils/ioredis-toolkit@b97f4ea`](https://github.com/org-utils/ioredis-toolkit/tree/b97f4eac0d7306cc2270279b3655c16d10fc4b4e/docker). Don't edit them; showcase-only changes go in `insight/`. To re-copy them, set `ref` to the upstream commit and run this from the repo root:

```sh
ref=b97f4eac0d7306cc2270279b3655c16d10fc4b4e
for mode in standalone sentinel cluster; do
  gh api -H "Accept: application/vnd.github.raw" \
    "repos/org-utils/ioredis-toolkit/contents/docker/$mode.compose.yml?ref=$ref" > "infra/$mode.compose.yml"
done
```

Then update the commit in this note.

## RedisInsight

`insight/<mode>.override.yml` is passed as a second `-f` and only adds to the `redisinsight` service. It accepts the terms (no consent dialog) and pre-sets the mode's database: standalone (`127.0.0.1:6379`) and cluster (seed `127.0.0.1:7001`) through `RI_REDIS_*` env vars, and sentinel through `insight/sentinel.databases.json` (sentinel `127.0.0.1:26379`, master `mymaster`), since a sentinel database can only be pre-set from a file. RedisInsight works out whether a database is standalone, sentinel or cluster on the first connect.

RedisInsight re-reads these settings on every start and deletes any pre-set database that has gone from them, so edit the files rather than the database in the UI. If the sentinel database ever needs adding by hand, add it through the sentinel at `127.0.0.1:26379`, never the master at 6380: the master changes after a failover.
