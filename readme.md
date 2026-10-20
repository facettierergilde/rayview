# Concave Ray View

Real-time gemstone renderer for faceted and concave-cut stones, built with [three.js](https://threejs.org).
It ray-traces light through the stone (multiple internal bounces, IOR, dispersion/chromatic aberration, Fresnel)
against HDRI or skybox environments, and runs in the browser or as a Windows desktop app ([NW.js](https://nwjs.io)).

Concave Ray View is developed by the [Facettierer Gilde Schweiz](https://www.facettieren.ch) and is designed to work
together with the [**RayCarve**](https://github.com/facettierergilde/raycarve) Blender plugin, which streams the stone you're cutting straight into the viewer.

## Features

- Physically based refraction with configurable bounces, IOR, Fresnel and chromatic aberration
- Load your own models: GLB, GLTF, STL and OBJ
- HDRI (`.hdr`) and six-image skybox environments, with exposure and room-size controls
- Live sync from Blender ([RayCarve](https://github.com/facettierergilde/raycarve)) over HTTP + WebSocket
- Camera presets, stone colour, position and rotation controls, turntable animation

## Requirements

- [Node.js](https://nodejs.org) 22 or newer
- A browser with WebGL 2
- Windows x64 for building the desktop app

## Getting started

```bash
git clone <repository-url>
cd RayView
npm install
npm run dev
```

Then open http://localhost:5173.

### Live sync with Blender (RayCarve)

Install the [RayCarve](https://github.com/facettierergilde/raycarve) Blender plugin; see its repository for
installation and usage. The viewer receives model updates from it through a small sync server. In a second terminal run:

```bash
npm run server
```

This starts an HTTP upload endpoint on port **3000** and a WebSocket on port **3001**.
RayCarve posts the current mesh to `http://localhost:3000/upload` (multipart form: `file` as STL, plus `name`,
`rotX`, `rotY`, `rotZ`, `pos`), and the viewer reloads it immediately.
In the desktop app the sync server starts automatically.

## Building the desktop app

```bash
npm run build:nw
```

The Windows app is written to `build/` (`build/concaverayview.exe`). Other scripts:

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 |
| `npm run server` | Sync server for development (ports 3000/3001) |
| `npm run build` | Production web build into `dist/` (including the bundled sync server) |
| `npm start` | Build and run the app with NW.js without packaging |
| `npm run build:nw` | Build and package the Windows x64 app into `build/` |

### Publishing a release

Releases are built by GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)).

1. Set the new version in both `package.json` and `public/package.json`, then commit.
2. Tag the commit and push the tag:

   ```bash
   git tag v1.1.0
   git push origin v1.1.0
   ```

The workflow checks that the tag matches both versions, builds the Windows app, and publishes
`ConcaveRayView-v1.1.0-win-x64.zip` as a GitHub release with generated release notes.

## Environments

Environments are listed in [`environments/environments.json`](environments/environments.json):

```json
"My HDRI":   { "isSkybox": false, "url": "./environments/hdri/my_hdri.hdr" },
"My Skybox": { "isSkybox": true,  "id":  "./environments/11" }
```

- **HDRI:** put a `.hdr` file in `environments/hdri/`.
- **Skybox:** put six images named `px.png`, `nx.png`, `py.png`, `ny.png`, `pz.png`, `nz.png` in a new folder.
  To create them from an HDRI, use [HDRI-to-CubeMap](https://matheowis.github.io/HDRI-to-CubeMap/) and choose the
  lowest layout option, where every face is exported as its own image.

Higher-resolution HDRIs (4k and up) give a sharper background.

## Project structure

```
assets/         App icon (.png/.ico) and credits page for the desktop build
environments/   HDRIs, skyboxes and environments.json
public/         Files served as-is (NW.js manifest, sync folder)
src/
  main.js             Scene, UI and render loop
  diamondMaterial.js  Refraction shader (BVH ray tracing via three-mesh-bvh)
  EffectShader.js     Exposure post-processing
  server.js           Sync server for Blender/RayCarve
default.glb     Stone loaded at startup
```

## License

Concave Ray View is licensed under the [GNU General Public License v3.0](LICENSE).

It is based on [diamonds](https://github.com/N8python/diamonds) by N8python (MIT), see
[THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES). The licenses of the bundled libraries are listed in
[assets/credits.html](assets/credits.html).
