# Fund Minute Board

This project has two public pages:

- `/` keeps minute history in each visitor's browser.
- `/server/` reads history sampled and stored by the Node server.

The service proxies the upstream fund site assets and API. The `/server/`
collector uses Playwright Chromium to render the upstream decoder page once per
minute and writes the current Shanghai-day history to
`server-data/history.json` locally.

## Local Run

```powershell
npm install
npx playwright install chromium
npm run dev
```

Open:

- Browser-sampled board: `http://127.0.0.1:3456/`
- Server-sampled board: `http://127.0.0.1:3456/server/`

## Railway Deploy

The repository includes `Dockerfile` and `railway.json`. Railway builds the
Docker image, installs Playwright Chromium in the image, supplies `PORT`, and
the service listens on `0.0.0.0` in the container.

1. Push this project to a GitHub repository.
2. Create a Railway project from that GitHub repository.
3. Add a Railway Volume to the web service and mount it at `/data`.
4. Set the service variable `DATA_DIR=/data`.
5. Generate a Railway public domain for the service.

Public URLs will be:

- Browser-sampled board: `https://YOUR-DOMAIN/`
- Server-sampled board: `https://YOUR-DOMAIN/server/`
- Health check: `https://YOUR-DOMAIN/health`

Without a Volume, redeploying or restarting the container can lose
server-collected history. A mounted Volume keeps `history.json` outside the
container filesystem.
