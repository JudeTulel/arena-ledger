# Demo walkthrough

A narrated 31-second demo is at [`game/demo.mp4`](demo.mp4).

## Play loop

1. Open the game at https://judetulel.github.io/arena-ledger/
2. Pick one of three battlegrounds:
   - **The Foundry** — indoor close-quarters rooms, corridors and crates.
   - **Verdant Ruins** — jungle foliage, ruins and heavy fog.
   - **Sunken Atoll** — open desert-island sightlines with water and palms.
3. Pick an operative: Scout (80 HP, fast), Marine (100 HP, balanced) or Heavy (150 HP, slow).
4. Pick a weapon. Level 1 unlocks Pistol and SMG; level 2 adds Rifle and Shotgun; level 3 adds Sniper and Launcher.
5. Click **Enter Match**. With the Adena extension installed the game connects the wallet and calls the realm's `Enter` function — a 2-token entry fee. Without Adena it runs in local demo mode with bots and simulated rewards.
6. Fight with WASD, mouse aim, click to fire, R to reload and 1–6 to swap weapons.
7. Every takedown shows a **+1.2** reward toast. During boosted windows (06:00, 12:00 and 18:00 UTC) the bounty doubles to 2.4, paid from the community pool.
8. Kills grant XP. Levels 2 and 3 unlock the heavier weapons.

## Chain state

The realm path is `gno.land/r/g16aehkv63k62ege7z7c7g5zc58mljklvtdkxd3u/arena` (onyx-1 testnet). The entry split is 1.2 tokens escrowed as the kill bounty and 0.8 tokens to the community pool. `ReportKill` emits a `Kill` event with the payout amount, and `Claim` moves pending earnings into the player's balance.

Deployment is pending an approver: onyx currently stores new packages in an inert state until an address in `PkgApprovers` sends `MsgEnablePackage`. The contracts lint and test clean locally against gno v1.8.0-rc.1; they are ready to activate as soon as approvals resume.
