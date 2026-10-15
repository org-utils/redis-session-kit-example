# ioredis-toolkit Showcase

The official example and playground for `ioredis-toolkit`: a Fastify backend and a Next.js frontend that exercise every part of the package against every connection mode, for people evaluating the package.

## Language

**Showcase**:
This repo as a whole: the backend, frontend and infrastructure that together demonstrate the package.
_Avoid_: demo app, sample, example project

**Connection mode**:
One of the three Redis deployments the package can connect to: `standalone`, `sentinel` or `cluster`. The showcase runs all three at once.
_Avoid_: topology, deployment type, environment

**Mode client**:
The single package client the backend holds for one connection mode, shared by every module running on that mode.
_Avoid_: connection, redis instance, shared client

**Event log**:
The recent record, per connection mode, of what happened in the background (failures the package reports outside any request, and health changes), shown live in the showcase.
_Avoid_: error log, activity feed, notifications

**Feature module**:
A part of the showcase that demonstrates one part of the package (session, cache, lock, rate-limit, pubsub, streams) and can run against any connection mode.
_Avoid_: feature, plugin, service

**Example**:
A ready-made, named set of inputs for one operation of a module, shipped with the showcase, which a visitor loads, edits and runs.
_Avoid_: preset, template, scenario, recipe

**Token wallet**:
Every session credential the showcase has handed one browser for one connection mode, kept so a visitor can present an old credential again (to replay it or log out with it).
_Avoid_: token history, token list, keychain

**Mode-specific module**:
A part of the showcase that demonstrates behaviour only one connection mode has, such as sentinel failover or cluster hash-slot routing.
_Avoid_: mode module, topology demo
