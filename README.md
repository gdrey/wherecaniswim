# WhereCanISwim

A lightweight calendar of [NYC Parks indoor pool schedules](https://www.nycgovparks.org/facilities/indoor-pools). Each session links to its official schedule. This is an independent project, not affiliated with NYC Parks.

## Publish on GitHub Pages

1. Create a **public** GitHub repository named `wherecaniswim` under `gdrey`.
2. Push the files in this folder to its `main` branch.
3. In the repository, open **Settings → Pages → Build and deployment** and select **GitHub Actions** as the source.
4. Open **Actions → Refresh schedules and publish → Run workflow**. After it succeeds, visit `https://gdrey.github.io/wherecaniswim/`.

The workflow also runs every four hours. It checks the NYC Parks directory and linked schedules for all listed indoor pools, writes `site/data/schedules.json`, and publishes the static site. If a source page is unavailable, the run fails and the previous published site remains in place. The site displays the time of the last successful check.

For a local refresh, run `node scripts/fetch-schedules.mjs` with Node.js 22 or newer. To preview locally, serve the `site` folder with a static HTTP server.
