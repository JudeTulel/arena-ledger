# Optional character models

The game runs fully with procedural characters. To swap in GLB models, add
files here and list them in `manifest.json`, for example:

```json
{ "scout": "./models/scout.glb", "marine": "./models/marine.glb", "heavy": "./models/heavy.glb" }
```

Budget: keep each GLB under 1-2 MB, Draco-compressed geometry, KTX2 textures,
shared materials. Models are normalized to 1.9 world units tall at runtime.
Any missing or failed load automatically falls back to the procedural body.
