# Arena Ledger realm contracts

Gno.land realm for the on-chain economy of Arena Ledger, a three.js
play-to-earn shooter. This directory is deploy-ready source only: onyx
testnet package approval is currently stalled, so nothing has been
deployed.

## Module

`gno.land/r/g16aehkv63k62ege7z7c7g5zc58mljklvtdkxd3u/arena`

## Token accounting

Token values are integers in **millitokens (mtok)**, with `1 token = 1000
mtok`. Balances are a private ledger inside the realm (`Player.Balance`,
`Player.Pending`, `Player.Bounty` and the `pool` variable). **No external
GRC20 package is imported** — the package may be inert, so all economics
are plain integer arithmetic in this realm.

A new account receives a one-time `startingBalance` of 2 tokens so it can
pay for its first entry.

| Flow | Amount | Source / destination |
|---|---:|---|
| `Enter` cost | 2.0 tokens (2000 mtok) | deducted from the caller's internal balance |
| kill bounty | 1.2 tokens (1200 mtok) | escrowed on the entrant (`Player.Bounty`) |
| community pool | 0.8 tokens (800 mtok) | added to `pool` |
| normal kill | 1.2 tokens (1200 mtok) | 1.2 from the victim's bounty allocation → killer's `Pending` |
| boosted kill | 2.4 tokens (2400 mtok) | 1.2 from the victim's allocation + 1.2 from `pool` → killer's `Pending` |

`1.2 + 0.8 = 2.0` exactly; the boosted top-up is exactly one additional
base bounty (`2.4 - 1.2 = 1.2`). The `Kill` event carries a numeric
`amount` attribute (`"1.2"` or `"2.4"`), which the client displays as
`+1.2` / `+2.4` in the HUD. A `Boost` event is emitted alongside a `Kill`
event whenever the kill lands inside a boosted window.

### Boosted windows

Three UTC hours per day, each a full hour:

- **06:00–06:59 UTC**
- **12:00–12:59 UTC**
- **18:00–18:59 UTC**

During these windows the kill bounty doubles from 1.2 to 2.4 tokens. The
extra 1.2 comes from the community pool, funded by the 0.8-token share of
every entry. A boost panics rather than paying if the pool cannot cover
the top-up.

## Player levels

XP comes from kills (40 base XP) and wins (60 base XP). Cumulative XP
thresholds:

| Level | Threshold | XP multiplier |
|---:|---:|---:|
| 0 (unranked) | 0 | 100% |
| 1 | 100 | 110% |
| 2 | 300 | 120% |
| 3 | 700 | 130% |

The multiplier is applied using the player's level **before** the award,
with integer truncation: a level-1 kill yields `40 * 110 / 100 = 44` XP.

## Public API

All crossing functions take `cur realm` first and guard with
`cur.Previous().IsUserCall()`. The internal helper `callerOf` checks
`cur.IsCurrent()` before reading the caller. Unrecoverable states panic.

```go
func Enter(cur realm)                    // pay 2 tokens, stake a bounty, fund the pool
func ReportKill(cur realm, victim string) // killer is the caller; pay the bounty
func ReportWin(cur realm)                // award win XP to the caller
func Claim(cur realm)                    // move Pending into Balance

func Render(path string) string          // docs, gno-forms and leaderboard

func Top() []*Player                     // top ten by better()
func better(a, b *Player) bool           // XP, kills, wins, address
func Pool() int64                        // community pool, mtok
func Players() int
func TotalEntries() int64
func TotalKills() int64
func TotalBoostKills() int64
func TotalDistributed() int64
func Balance(a address) int64
```

Events emitted: `Enter`, `Kill`, `Boost`, `Claim` (plus `Win` for win XP).

`Render()` includes gno-forms for `Enter`, `ReportKill`, `ReportWin` and
`Claim`, plus a ten-row leaderboard. Player addresses are wrapped with
`sanitize.InlineText` before being written into the markdown table.

## Files

- `arena.gno` — realm implementation
- `gnomod.toml` — module declaration
- `arena_test.gno` — unit tests for the economy maths and the ranking helper
- `README.md` — this file

## Local verification

The chain-matched toolchain is the `gno` binary from
`gnostore/v1.8.0-rc.1` with `GNOROOT` pointing at
`$(go env GOMODCACHE)/github.com/gnolang/gno@v1.8.0-rc.1`, `GNOHOME` at
`gnohome-onyx`, and an empty `gnowork.toml` in a workspace containing the
package:

```sh
cd <workspace>                 # gnowork.toml (empty) here
gno lint ./arena
gno test ./arena
```

Both lint and tests pass locally. No commits, pushes or deployments were
made.
