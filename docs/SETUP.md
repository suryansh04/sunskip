# SunSkip setup and verification

How to run SunSkip on your laptop, how the live system is deployed and updated, and what has been checked. Every command here was run on 9 Oct 2026 from a fresh clone of `github.com/suryansh04/sunskip` (Windows 11, PowerShell and Git Bash); the results are in [§6](#6-verification-record).

For what we build and why, read `PRD.md`; for the stack and rules, `TRD.md` and `CLAUDE.md`; for endpoints, `api.md`; for tables, `schema.md`.

## 1. What works today

| Part                                     | State                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| Backend API (`api/`), 18 endpoints       | Built and live. Agent and voice endpoints answer `501` until P2 adds them |
| Shade worker (Google Solar + OSM)        | Built and live                                                           |
| Data loaded                              | MUJ and the 11 Jaipur metro station areas: 970 shade cells, ~48k paths   |
| Student app (`app/`), portal (`portal/`) | Not built yet                                                            |
| AR (`app/src/features/ar`)               | P3, not started; `GET /routes/{tripId}/options/{optionId}/waypoints` is ready for it |

**Live API:** `https://7mhceh7sl0.execute-api.ap-southeast-2.amazonaws.com/v1`. Every call except `/health` needs an `X-Client-Id` header (any stable id per device). `/v1/portal/*` also needs a Cognito login token.

```bash
curl -H "X-Client-Id: my-laptop" https://7mhceh7sl0.execute-api.ap-southeast-2.amazonaws.com/v1/meta
```

## 2. What you need

| Tool           | Version used         | Needed for                        |
| -------------- | -------------------- | --------------------------------- |
| Git            | any                  | everything                        |
| Python         | **3.12** (3.12.10)   | the API                           |
| Docker Desktop | 29.x                 | the local database                |
| Google API key | Routes, Solar, Air Quality APIs enabled | real mode only (§3.6) |
| AWS CLI        | 2.x                  | deploying only (§5)               |

Front-end developers can skip the Google key: fakes mode (§3.5) returns the real pilot numbers with no key and no data.

## 3. Run it on your laptop

Commands are for **Windows PowerShell**; the macOS/Linux version is under each one where it differs.

### 3.1 Clone

```powershell
git clone https://github.com/suryansh04/sunskip.git
cd sunskip/api
```

The repo is private: ask Suryansh to add your GitHub account first.

### 3.2 Python environment (about 4 minutes)

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

macOS/Linux: `python3.12 -m venv .venv` and `source .venv/bin/activate`.

Check: `python -c "import fastapi, rasterio; print('ok')"` prints `ok`.

### 3.3 Settings

```powershell
Copy-Item .env.example .env
```

macOS/Linux: `cp .env.example .env`. Leave `SECRET_ID` empty: it's the name of the production secret, and when it's set the app tries to read AWS Secrets Manager instead of `.env`. Never put AWS keys in `.env` (they go in `aws configure`), and never commit `.env` (it's git-ignored).

### 3.4 Database (Postgres 16 + PostGIS in Docker, port 5433)

```powershell
docker compose -f docker-compose.dev.yml up -d
# wait ~10 s: the PostGIS image restarts once while it sets itself up
python -m scripts.migrate
```

Check: the first run prints `applied 0001_init.sql`; running it again prints nothing. Port 5433 is used so it never clashes with a Postgres already on your laptop.

### 3.5 Fakes mode (no key, no data; for front-end work)

```powershell
$env:USE_FAKES = "true"; uvicorn app.main:app --reload
```

macOS/Linux: `USE_FAKES=true uvicorn app.main:app --reload`. Or set `USE_FAKES=true` in `.env`.

Check (Git Bash or any shell with curl):

```bash
curl -H "X-Client-Id: dev" -H "Content-Type: application/json" \
  -d '{"origin":{"lat":26.84406,"lng":75.56516},"destination":{"lat":26.83894,"lng":75.56537}}' \
  http://127.0.0.1:8000/v1/routes/plan
```

You get the MUJ to Bus 26 walk: `walkMeters: 810`, `sunMinutes: 11.3`. `/routes/best-time` gives 11.3 and 7.4, and `/conditions` a feels-like of 44 °C. The interactive docs are at `http://127.0.0.1:8000/docs`.

Use `127.0.0.1`, not `localhost`: on Windows `localhost` tries IPv6 first and every call waits ~2 s.

### 3.6 Real mode (Google key, real shade data)

1. Put your key in `.env`: `GOOGLE_API_KEY=...` and `USE_FAKES=false`.
2. Start the API and, in a second terminal (venv activated), the worker:
   ```powershell
   uvicorn app.main:app --reload
   python -m app.worker
   ```
3. Load the MUJ demo area (about 4 minutes; 41 Solar calls of the 6,500 monthly budget):
   ```powershell
   python -m scripts.preload --area muj
   ```
   It prints `41 cells and 6 OSM areas queued`; the worker logs `Job ... done` when it's finished.
   `--area jaipur-metro` loads the 11 metro station areas (~430 cells, ~35 minutes, because Google allows only so many shade downloads a minute).
4. Draw the e-rickshaw zones and estimate walkers per path:
   ```powershell
   python -m scripts.seed_zones
   python -m app.worker.demand
   ```
   Stretches are rebuilt by the worker after every job; `python -m app.worker.stretches` rebuilds them all by hand.

Check: the plan request from §3.5 now gives `sunMinutes: 11.3` at `"departAt":"2026-05-15T13:00:00+05:30"` and `7.6` at 17:00, and `GET /v1/health` shows `"status":"ok"` with `cellsReady` > 0.

Any other place in India works too: plan a trip there, and the answer comes back with `shade.status: "PREPARING"` and a `jobId` while the worker fetches it (each device may queue 60 new cells a day).

### 3.7 Before you push

```powershell
ruff check .
ruff format --check .
```

Both must pass (`ruff` also checks type hints). GitHub runs the same two checks on every push and pull request (`.github/workflows/ci.yml`). Work on a branch per task and merge into `main` (see `CLAUDE.md`).

## 4. How production is built

Everything is in AWS account `056362973989`, region **ap-southeast-2 (Sydney)**. The AWS free plan locks the project to one region and to free-tier server types, which is why it isn't Mumbai or `t3.medium` as first planned.

| Piece           | Name / setting                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| API Gateway     | `https://7mhceh7sl0.execute-api.ap-southeast-2.amazonaws.com/v1`; `/v1/portal/*` needs a Cognito token; 50 requests/s |
| EC2             | `i-0384760bd67270bbf`, `c7i-flex.large` (2 vCPU, 4 GB), IP `54.252.107.180`; runs the `api` and `worker` containers in `/srv/sunskip/api` |
| RDS             | `sunskip-db`, PostgreSQL 16.15, `db.t4g.micro`, private (only the server can reach it)             |
| S3              | `sunskip-shade-056362973989`: Solar shade files under `shade/`, deploy bundles under `deploy/`     |
| Secrets Manager | `sunskip/prod`: Google key, database URL, origin secret, client id salt                            |
| Cognito         | domain `sunskip-056362973989.auth.ap-southeast-2.amazoncognito.com`, app client `11rmbr2ou4l8kq1b5crik6mn85` |
| Access          | no SSH; the server is reached through AWS Systems Manager. Port 8000 is open, but the server refuses any call without the gateway's secret header |

**Cost:** about $3 a day from the free-plan credits (server ~$2.3, database ~$0.7).

## 5. Running production

All commands are for Git Bash with the AWS CLI configured for the account above (`aws sts get-caller-identity` shows `056362973989`).

```bash
export AWS_DEFAULT_REGION=ap-southeast-2 MSYS_NO_PATHCONV=1
BUCKET=sunskip-shade-056362973989
INSTANCE=i-0384760bd67270bbf
```

### 5.1 Update the live code (about 3 minutes)

From the repo root, on an up-to-date `main`:

```bash
git archive --format=tar.gz -o api.tar.gz main api
aws s3 cp api.tar.gz s3://$BUCKET/deploy/api.tar.gz && rm api.tar.gz
aws ssm send-command --instance-ids $INSTANCE --document-name AWS-RunShellScript \
  --query Command.CommandId --output text --parameters '{"commands":[
    "export PATH=$PATH:/snap/bin", "cd /srv/sunskip",
    "aws s3 cp s3://sunskip-shade-056362973989/deploy/api.tar.gz . --only-show-errors",
    "tar -xzf api.tar.gz", "cd api", "docker compose build -q",
    "docker compose run --rm -T api python -m scripts.migrate",
    "docker compose up -d", "sleep 15", "docker compose ps"],
  "executionTimeout":["1800"]}'
```

Then read the result with the command id it printed, and check health:

```bash
aws ssm get-command-invocation --command-id <id> --instance-id $INSTANCE --query "[Status,StandardOutputContent]" --output text
curl https://7mhceh7sl0.execute-api.ap-southeast-2.amazonaws.com/v1/health
```

You want `Success`, both containers `Up`, and `"status":"ok"`. New migrations in `api/migrations/` run as part of the update.

### 5.2 Watch it

- `GET /v1/health`: database, S3, the worker's last heartbeat, the job queue and Solar calls used this month. `"status":"degraded"` means a service failed last time or the worker went quiet for 2 minutes.
- Logs: send `cd /srv/sunskip/api && docker compose logs --tail 100 worker` (or `api`) the same way as §5.1.

### 5.3 Rotate the Google key

1. Make a new key in Google Cloud (Routes, Solar and Air Quality APIs) and delete the old one.
2. Update only that field of the secret (Git Bash, Python available):
   ```bash
   aws secretsmanager get-secret-value --secret-id sunskip/prod --query SecretString --output text \
     | NEW_KEY='<new key>' python -c "import json,os,sys; s=json.load(sys.stdin); s['GOOGLE_API_KEY']=os.environ['NEW_KEY']; print(json.dumps(s))" \
     > secret.json && aws secretsmanager put-secret-value --secret-id sunskip/prod --secret-string file://secret.json && rm secret.json
   ```
3. Restart the containers so they read it: send `cd /srv/sunskip/api && docker compose restart` as in §5.1.

### 5.4 Add a portal login

```bash
aws cognito-idp admin-create-user --user-pool-id ap-southeast-2_kb0XfRcnQ --username official@example.com \
  --user-attributes Name=email,Value=official@example.com Name=email_verified,Value=true
```

Cognito emails a temporary password. The pool is `sunskip-portal` (`ap-southeast-2_kb0XfRcnQ`). The hosted login page only redirects to `http://localhost:5174/callback` until the portal is on Amplify; its real URL has to be added to the app client and to the API Gateway CORS list then.

### 5.5 Stop paying when idle

```bash
aws ec2 stop-instances --instance-ids $INSTANCE
aws rds stop-db-instance --db-instance-identifier sunskip-db
```

Start them again with `start-instances` and `start-db-instance`; the containers start by themselves (`restart: unless-stopped`). AWS restarts a stopped database by itself after 7 days. The Elastic IP costs a little while the server is stopped.

## 6. Verification record

Run on 9 Oct 2026.

| Step                                    | Result                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| 3.1 clone from GitHub                   | 2 s                                                                                      |
| 3.2 venv + `pip install`                | 243 s; fastapi 0.142.4, rasterio 1.5.2 import                                            |
| 3.4 database + migrate (twice)          | `applied 0001_init.sql`, second run no-op                                                |
| 3.5 fakes mode                          | health 200; `/meta` without `X-Client-Id` is 400; plan 810 m / 11.3 min; best-time 11.3, 7.4; conditions 44 °C; `/docs` 200 |
| 3.6 preload MUJ (empty database)        | 41 cells + 6 OSM areas ready in 230 s; 1,069 paths scored, 481 stretches                 |
| 3.6 zones, demand, stretches            | 1 zone, 1,069 paths estimated, 481 stretches                                             |
| 3.7 ruff                                | `All checks passed`, 76 files formatted                                                  |
| Full endpoint checks on the fresh clone | 28 / 28 pass (plan 11.3 at 1 PM and 7.6 at 5 PM, best-time, waypoints, choice, shade map, every portal endpoint, the error cases) |
| 5.1 production update                   | `Success`, both containers up, health `ok`                                               |
| Full endpoint checks on production      | 28 / 28 pass; through the gateway a plan takes 1.2–1.6 s from India; portal without login 401; direct server call without the secret 403 |
| GitHub CI                               | ruff check + format pass                                                                 |

Not covered here because they aren't built yet: the student app, the portal, Amplify hosting, agent chat, voice and AR.

## 7. When something goes wrong

| Symptom                                                    | Cause and fix                                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `port is already allocated` on 5433                        | Another database container uses it: `docker ps`, then stop the old one.                                     |
| App starts but crashes in `load_settings` / Secrets Manager | `SECRET_ID` is set in `.env`; empty it for local runs.                                                     |
| Every local call takes ~2 s                                | Use `127.0.0.1` instead of `localhost`.                                                                    |
| `403 FORBIDDEN "No access"`                                | `ORIGIN_SECRET_CHECK` is on without a secret; set `ORIGIN_SECRET_CHECK=false` locally.                     |
| Plan works but `shade.status` stays `PREPARING`            | The worker isn't running, or Google's per-minute shade download quota is being waited out; watch the worker log. |
| Google answers 403 `SERVICE_DISABLED`                      | Enable the Routes, Solar and Air Quality APIs for the key's Google Cloud project.                         |
| `ImportError` mentioning `libexpat` in Docker              | Rebuild the image; the `Dockerfile` installs `libexpat1` for rasterio.                                     |
| AWS: `not eligible for Free Tier` or access denied outside Sydney | Free-plan limits: use `ap-southeast-2` and a free-tier server type.                                 |
| Claude Code refuses to deploy in auto mode                 | Its safety check blocks production changes; switch to default mode and approve the command.               |
