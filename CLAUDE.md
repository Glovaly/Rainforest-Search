# CLAUDE.md - ASIN Finder

## 1. Project Overview

ASIN Finder is a web application that takes a CSV file of product titles (typically from a competitor's catalog), searches each title on Amazon via the EasyParser API, and returns the matching ASIN and product URL for each title. It is designed for e-commerce teams and competitive intelligence analysts who need to map competitor product catalogs to Amazon listings at scale.

The core workflow is: upload CSV of product titles -> queue each title for Amazon search -> display real-time progress via SSE -> download results as CSV.

The app is single-user (admin-only login) and stores all job history and results in Supabase (PostgreSQL).

---

## 2. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 20 (Alpine Docker image) |
| Framework | Express.js | ^4.21.0 |
| View Engine | EJS | ^3.1.10 |
| Database | Supabase (PostgreSQL) | @supabase/supabase-js ^2.45.0 |
| CSV Parsing | csv-parse | ^5.5.0 |
| File Upload | multer | ^1.4.5-lts.1 |
| Concurrency | p-queue | ^6.6.2 |
| Auth | bcrypt + express-session | bcrypt ^5.1.1, express-session ^1.18.0 |
| UUIDs | uuid | ^10.0.0 |
| Env Config | dotenv | ^17.3.1 |
| External API | EasyParser (realtime.easyparser.com) | REST v1 |
| Deployment | Railway (via Dockerfile) | Node 20-alpine |

**No test framework is configured.** There are no test scripts or test files in the project.

---

## 3. Folder Structure

```
/
├── server.js                    # Express app entry point, middleware setup, route mounting
├── package.json                 # Dependencies and scripts (start, dev)
├── Dockerfile                   # Node 20-alpine production image
├── railway.json                 # Railway deployment config (Dockerfile builder, healthcheck)
├── .env.example                 # Template for required/optional environment variables
├── .gitignore                   # Ignores node_modules, .env, *.db, .DS_Store
├── supabase-schema.sql          # SQL DDL for all tables and indexes (run in Supabase SQL Editor)
├── CLAUDE.md                    # This file
│
├── src/
│   ├── config.js                # Centralized env var loading with defaults
│   ├── db.js                    # Supabase client + all database CRUD functions
│   │
│   ├── middleware/
│   │   ├── auth.js              # requireAuth middleware (session check, JSON/SSE-aware 401)
│   │   └── errorHandler.js      # Global Express error handler (JSON or HTML based on Accept)
│   │
│   ├── routes/
│   │   ├── auth.js              # GET/POST /login, POST /logout
│   │   ├── jobs.js              # GET / (dashboard), GET /jobs/:id, GET /api/competitors
│   │   ├── upload.js            # POST /upload (CSV file + competitor name)
│   │   ├── download.js          # GET /jobs/:id/download (CSV export)
│   │   └── sse.js               # GET /jobs/:id/progress (Server-Sent Events stream)
│   │
│   └── services/
│       ├── easyParserApi.js     # EasyParser API client with timeout, rate limit, retry errors
│       ├── searchQueue.js       # p-queue based job processor, EventEmitter for SSE events
│       ├── csvParser.js         # CSV parsing with BOM stripping, delimiter detection, column aliases
│       └── csvExporter.js       # CSV generation for download with proper escaping and BOM
│
├── views/
│   ├── dashboard.ejs            # Main page: upload form, progress, results table, job history
│   └── login.ejs                # Login page (standalone, no layout)
│
└── public/
    ├── js/
    │   └── app.js               # Frontend: upload handling, SSE subscription, live result table
    └── css/
        └── style.css            # All styles: layout, cards, forms, progress bar, tables, badges
```

---

## 4. Architecture & Data Flow

### Complete Upload-to-Download Flow

```
1. UPLOAD
   Browser (FormData: csv file + competitor name)
     -> POST /upload
     -> multer parses file (memory storage, 10MB limit, CSV only)
     -> csvParser.parseCsv() extracts titles from CSV buffer
     -> db.getOrCreateCompetitor() upserts competitor in Supabase
     -> db.createJob() inserts job row (status: 'pending')
     -> db.createResults() batch-inserts all title rows (status: 'pending', batches of 500)
     -> searchQueue.processJob(jobId) called fire-and-forget
     -> Response: { jobId, totalTitles, competitor }

2. QUEUE PROCESSING (background, runs in-process)
   searchQueue.processJob(jobId):
     -> db.updateJobStatus(jobId, 'processing')
     -> db.getPendingResults(jobId) fetches all pending result rows (paginated at 1000)
     -> Each result added to p-queue (concurrency: CONCURRENCY, rate limited: intervalCap/interval)
     -> For each title:
        -> easyParserApi.searchProduct(title) calls EasyParser REST API
        -> On success: db.updateResult() with ASIN/URL/status, db.incrementJobCounter()
        -> On rate limit (429): pause entire queue, exponential backoff, resume
        -> On other error: retry up to MAX_RETRIES with linear backoff
        -> After all retries exhausted: mark result as 'error'
        -> Emit SSE event with current progress + latest result
     -> After all titles processed:
        -> db.updateJobStatus(jobId, 'completed')
        -> Emit 'done' SSE event

3. REAL-TIME UPDATES (SSE)
   Browser opens EventSource -> GET /jobs/:id/progress
     -> Server sends initial 'snapshot' event with current counters
     -> If job already completed/failed, sends 'done' event and closes
     -> Otherwise subscribes to searchQueue EventEmitter for live events
     -> Each processed title emits 'progress' event with counters + latestResult
     -> On 'done' or 'error', connection closes
     -> On client disconnect, listener is cleaned up

4. FRONTEND RENDERING
   app.js receives SSE events:
     -> 'snapshot'/'progress': updateProgress() updates progress bar + stat counters
     -> 'progress' with latestResult: appendResultRow() adds row to results table
     -> 'done': shows download button, re-enables upload form
     -> 'error': alerts user

5. DOWNLOAD
   GET /jobs/:id/download
     -> db.getResultsByJobId() fetches all results (paginated at 1000)
     -> csvExporter.exportToCsv() generates CSV string
     -> Response: CSV file with UTF-8 BOM for Excel compatibility
     -> Filename: results-{competitor}-{jobId8chars}.csv
```

### Key Architectural Decisions

- **Single-process**: The queue runs in the same Node.js process. No separate worker. This means restarting the server kills in-progress jobs.
- **Fire-and-forget processing**: Upload returns immediately; processing happens asynchronously.
- **EventEmitter for SSE**: `searchQueue` extends `EventEmitter`. Events are namespaced per job (`job:{jobId}`). Max listeners set to 50.
- **No WebSocket**: Uses native SSE (EventSource) which auto-reconnects and is simpler than WebSocket for one-way server-to-client updates.

---

## 5. External Integrations

### EasyParser API

- **Endpoint**: `https://realtime.easyparser.com/v1/request`
- **Method**: GET (query string parameters)
- **Authentication**: API key via `api_key` query parameter
- **Parameters**:
  | Param | Value | Notes |
  |-------|-------|-------|
  | `api_key` | `config.EASYPARSER_API_KEY` | Required |
  | `platform` | `AMZ` | Amazon |
  | `operation` | `SEARCH` | Product search |
  | `domain` | `config.AMAZON_DOMAIN` | Default: `.com` |
  | `keyword` | product title string | URL-encoded automatically |
  | `output` | `json` | Response format |
- **Request Headers**: `Accept: application/json`, `User-Agent: ASINFinder/1.0`
- **Timeout**: 30 seconds (AbortController)
- **Response Format** (success):
  ```json
  {
    "request_info": { "success": true, "status_code": 200 },
    "result": {
      "search_results": [
        { "asin": "B0...", "url": "https://...", "title": "..." }
      ]
    }
  }
  ```
  The code checks three possible result paths: `result.search_results`, `result.results`, or `result` if it's an array.
- **Error responses**:
  - HTTP 429: Rate limit. `retry-after` header parsed if present.
  - Non-JSON response (HTML): Usually means Cloudflare is blocking. Logged and thrown as 502.
  - `request_info.success === false`: API-level error with message.
- **Custom Error Classes**:
  - `RateLimitError` (extends Error) - carries `retryAfterMs`
  - `ApiError` (extends Error) - carries `statusCode`

### Supabase

- **Client**: `@supabase/supabase-js` initialized with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
- **Service Key**: Uses the service role key (bypasses RLS). This is intentional since the app has its own auth layer.
- **Important Limitation**: Supabase returns a maximum of 1000 rows per query. All multi-row reads use manual pagination with `.range(from, from + pageSize - 1)` in a while loop.
- **Batch Inserts**: Results are inserted in batches of 500 to stay within Supabase's insert limit.

---

## 6. Database Schema

### `competitors` table
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | SERIAL | PRIMARY KEY | Auto-increment |
| `name` | TEXT | UNIQUE, NOT NULL | Case-insensitive lookup via `.ilike()` |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

### `jobs` table
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PRIMARY KEY | Generated client-side via `uuid.v4()` |
| `competitor_id` | INTEGER | NOT NULL, FK -> competitors(id) | |
| `filename` | TEXT | NOT NULL | Original uploaded filename |
| `total_titles` | INTEGER | NOT NULL, DEFAULT 0 | Count of titles from CSV |
| `completed` | INTEGER | NOT NULL, DEFAULT 0 | Processed count (found + not_found + errors) |
| `found` | INTEGER | NOT NULL, DEFAULT 0 | Titles with ASIN match |
| `not_found` | INTEGER | NOT NULL, DEFAULT 0 | Titles with no ASIN match |
| `errors` | INTEGER | NOT NULL, DEFAULT 0 | Titles that failed after retries |
| `status` | TEXT | NOT NULL, DEFAULT 'pending' | pending -> processing -> completed/failed |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `completed_at` | TIMESTAMPTZ | nullable | Set when status becomes completed or failed |

### `results` table
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | SERIAL | PRIMARY KEY | Auto-increment |
| `job_id` | UUID | NOT NULL, FK -> jobs(id) ON DELETE CASCADE | |
| `competitor_id` | INTEGER | NOT NULL, FK -> competitors(id) | |
| `original_title` | TEXT | NOT NULL | The product title from the CSV |
| `asin` | TEXT | nullable | Amazon ASIN if found |
| `product_url` | TEXT | nullable | Amazon product URL if found |
| `status` | TEXT | NOT NULL, DEFAULT 'pending' | pending -> found/not_found/error |
| `error_message` | TEXT | nullable | Error details if status is 'error' |
| `attempts` | INTEGER | NOT NULL, DEFAULT 0 | Number of API call attempts |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

### Indexes
| Index | Table | Column(s) |
|-------|-------|-----------|
| `idx_results_job_id` | results | job_id |
| `idx_results_competitor_id` | results | competitor_id |
| `idx_results_asin` | results | asin |
| `idx_jobs_competitor_id` | jobs | competitor_id |

### Relationships
- `jobs.competitor_id` -> `competitors.id` (many-to-one)
- `results.job_id` -> `jobs.id` (many-to-one, CASCADE delete)
- `results.competitor_id` -> `competitors.id` (many-to-one)

---

## 7. Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EASYPARSER_API_KEY` | Yes | none | API key for EasyParser product search |
| `SESSION_SECRET` | Yes | `'change-me-in-production'` | Secret for express-session cookie signing |
| `ADMIN_PASSWORD` | Yes | none | Password for admin login (plaintext in env, hashed at startup via bcrypt) |
| `SUPABASE_URL` | Yes | none | Supabase project URL (e.g., `https://xxxxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Yes | none | Supabase service role key (NOT the anon key) |
| `PORT` | No | `3000` | HTTP server port |
| `ADMIN_USERNAME` | No | `'admin'` | Username for admin login |
| `CONCURRENCY` | No | `2` | Max concurrent API requests in p-queue |
| `REQUEST_DELAY_MS` | No | `500` | Minimum interval between API requests (ms) |
| `MAX_RETRIES` | No | `2` | Number of retry attempts per title (total attempts = MAX_RETRIES + 1) |
| `RETRY_BASE_DELAY_MS` | No | `2000` | Base delay for exponential/linear backoff (ms) |
| `AMAZON_DOMAIN` | No | `'.com'` | Amazon domain suffix (e.g., `.com`, `.co.uk`, `.com.mx`) |

**Note**: If `ADMIN_PASSWORD` is not set, the login page shows an error message and login is impossible. The password is hashed once at startup using bcrypt with salt rounds of 10.

---

## 8. Key Implementation Details

### CSV Parsing Robustness (`src/services/csvParser.js`)
- Strips UTF-8 BOM (`\uFEFF`) which is common in Excel-exported CSVs.
- Tries comma delimiter first; if parsing fails, retries with semicolon (`;`) delimiter for Latin American CSV formats.
- Uses `relax_column_count: true` to handle rows with inconsistent column counts.
- Searches for the title column using multiple aliases: `title`, `titulo`, `titulo` (with accent), `product_title`, `product`, `nombre`, `name`.
- Falls back to the first column if no alias matches.
- Filters out empty title strings.

### Concurrency Control with p-queue (`src/services/searchQueue.js`)
- Uses `p-queue` v6 (CommonJS compatible, v7+ is ESM-only).
- Configuration: `concurrency` controls max parallel API calls, `interval` sets the time window, `intervalCap` limits requests per interval.
- With defaults (`CONCURRENCY=2`, `REQUEST_DELAY_MS=500`): processes up to 2 requests every 500ms.
- All titles for a job are added to the queue at once via `Promise.allSettled()`, which ensures all titles are processed even if some fail.

### Rate Limiting & Retry Strategy
- **Rate limit (HTTP 429)**: The entire queue is paused. Delay comes from `retry-after` header if present, otherwise exponential backoff: `RETRY_BASE_DELAY_MS * 2^(attempt-1)`.
- **Other errors**: Linear backoff: `RETRY_BASE_DELAY_MS * attempt`.
- **Total attempts**: `MAX_RETRIES + 1` (1 initial + MAX_RETRIES retries). Default: 3 total attempts.
- After all retries exhausted: result is marked as `error` with the last error message stored.

### SSE Real-Time Updates
- Endpoint: `GET /jobs/:id/progress` returns `text/event-stream`.
- On connection, sends a `snapshot` event with current job counters (supports reconnection).
- If job is already completed/failed at connection time, sends `done` and closes immediately.
- Live events emitted by `searchQueue` EventEmitter, namespaced as `job:{jobId}`.
- Event types: `snapshot`, `progress` (with `latestResult`), `done`, `error`.
- Client cleanup: listener removed on `req.close` event.
- Max listeners on the EventEmitter set to 50 to avoid warnings.

### Supabase Pagination (1000-Row Limit Workaround)
- Supabase's `.select()` returns a maximum of 1000 rows by default.
- `getResultsByJobId()` and `getPendingResults()` use a `while(true)` loop with `.range(from, from + pageSize - 1)` to paginate through all rows.
- Loop breaks when returned data length is less than `pageSize` or when no data is returned.

### Batch Inserts
- `createResults()` splits the result array into batches of 500 rows and inserts sequentially.
- This avoids Supabase's payload size limits on large inserts.

### Job Counter Updates (Race Condition Note)
- `incrementJobCounter()` does a read-then-write (SELECT then UPDATE) which is not atomic.
- Under high concurrency, counters may drift slightly. This is a known trade-off for simplicity.
- The counters are informational (progress display) and the actual results in the `results` table are the source of truth.

### CSV Export (`src/services/csvExporter.js`)
- Outputs columns: `Competitor, Original Title, ASIN, Product URL, Status`.
- Properly escapes CSV fields containing commas, double quotes, or newlines.
- Response includes UTF-8 BOM (`\uFEFF`) prefix for Excel compatibility.

---

## 9. Common Commands

```bash
# Install dependencies
npm install

# Development (with auto-reload via Node --watch)
npm run dev

# Production start
npm start

# Deploy to Railway
# Push to connected git repo; Railway auto-deploys via Dockerfile

# Set up database
# Copy contents of supabase-schema.sql into Supabase SQL Editor and run
```

**No test commands exist.** The project has no test framework or test files.

---

## 10. API Routes

### Authentication Routes (`src/routes/auth.js`)

| Method | Path | Auth | Handler | Purpose |
|--------|------|------|---------|---------|
| GET | `/login` | No | Renders `login.ejs` | Login page (redirects to `/` if already authenticated) |
| POST | `/login` | No | Validates credentials | Checks username/password against env vars via bcrypt |
| POST | `/logout` | No | Destroys session | Redirects to `/login` |

### Dashboard & Job Routes (`src/routes/jobs.js`)

| Method | Path | Auth | Handler | Purpose |
|--------|------|------|---------|---------|
| GET | `/` | Yes | Renders `dashboard.ejs` | Main page with upload form, job history |
| GET | `/jobs/:id` | Yes | JSON response | Returns job details + all results as JSON |
| GET | `/api/competitors` | Yes | JSON response | Returns list of all competitors |

### Upload Route (`src/routes/upload.js`)

| Method | Path | Auth | Handler | Purpose |
|--------|------|------|---------|---------|
| POST | `/upload` | Yes | Processes CSV + starts job | Accepts multipart form (field `csv` for file, `competitor` for name). Returns `{ jobId, totalTitles, competitor }` |

### Download Route (`src/routes/download.js`)

| Method | Path | Auth | Handler | Purpose |
|--------|------|------|---------|---------|
| GET | `/jobs/:id/download` | Yes | CSV file response | Downloads results CSV for a completed job |

### SSE Route (`src/routes/sse.js`)

| Method | Path | Auth | Handler | Purpose |
|--------|------|------|---------|---------|
| GET | `/jobs/:id/progress` | Yes | SSE stream | Real-time progress events for a job |

### Health Check (defined in `server.js`)

| Method | Path | Auth | Handler | Purpose |
|--------|------|------|---------|---------|
| GET | `/health` | No | JSON response | Returns `{ status: 'ok', timestamp }`. Used by Railway healthcheck. |

---

## 11. Frontend

### Views

- **`login.ejs`**: Standalone login page. Simple form with username/password. Shows error message from server if login fails. No layout template.
- **`dashboard.ejs`**: Main application page. Contains four sections:
  1. Upload Section: Competitor dropdown (with "Add new" option) + CSV file input + submit button.
  2. Progress Section (hidden initially): Progress bar + stats row (completed/found/not_found/errors/total).
  3. Results Section (hidden initially): Live results table with download button (shown after completion).
  4. Job History: Server-rendered table of recent jobs (last 20) with status badges and action buttons (Download for completed, View Progress for processing).

### Key JavaScript Functions (`public/js/app.js`)

| Function | Purpose |
|----------|---------|
| `(competitor dropdown handler)` | Toggles visibility of "new competitor" text input when "Add new" is selected |
| `(upload form handler)` | Submits FormData via `fetch()` to `/upload`, handles auth redirect (401/redirected), starts SSE on success |
| `startSSE(jobId)` | Opens `EventSource` to `/jobs/{jobId}/progress`, handles snapshot/progress/done/error events |
| `resumeSSE(jobId)` | Called from job history "View Progress" button, calls `startSSE()` and scrolls to top |
| `updateProgress(data)` | Updates progress bar width/percentage and all stat counter elements |
| `appendResultRow(result)` | Creates a new `<tr>` in the results table with title (truncated to 80 chars), ASIN, product URL link, status badge. Auto-scrolls to latest row. |
| `onJobComplete(data)` | Re-enables upload button, shows download button, updates progress to final values |
| `escapeHtml(text)` | XSS-safe HTML escaping using DOM `textContent`/`innerHTML` trick |

### Global State Variables
- `currentJobId`: UUID of the currently active/viewed job
- `eventSource`: Current `EventSource` instance (closed before opening new one)
- `rowCount`: Sequential counter for result table row numbers

### SSE Event Handling Flow
1. On upload success, `startSSE(jobId)` is called.
2. `EventSource` connects to `/jobs/{jobId}/progress`.
3. `snapshot` event updates counters to current state (reconnection support).
4. `progress` events update counters and append result rows to the live table.
5. `done` event closes the connection, shows download button, re-enables upload.
6. `error` event alerts user and closes connection.
7. If the browser detects an SSE connection loss, `EventSource` auto-reconnects (built-in browser behavior). The server sends a fresh `snapshot` on reconnect.

### Session Expiry Handling in Frontend
The upload handler checks for `res.redirected || res.status === 401` and redirects to `/login`. This handles the case where the session has expired during a long idle period.

---

## 12. Error Handling

### API Errors (`src/services/easyParserApi.js`)
- **RateLimitError**: HTTP 429. Carries `retryAfterMs`. Queue is paused and resumed after delay.
- **ApiError**: Any non-2xx HTTP status. Carries `statusCode` and `message`.
- **Non-JSON Response**: EasyParser sometimes returns HTML (Cloudflare challenge page). Detected by checking `content-type` header. Logged with first 500 chars of body. Thrown as ApiError with status 502.
- **Timeout**: 30-second AbortController timeout. Thrown as ApiError with status 408.
- **API-level failures**: `request_info.success === false` in JSON response. Message extracted from `request_info.message`.

### Queue/Job Errors (`src/services/searchQueue.js`)
- Individual title errors: After retries exhausted, result row updated with `status: 'error'` and `error_message`. Job continues processing other titles.
- Job-level errors (e.g., database failure during processing): Job status set to `failed`, `error` SSE event emitted.
- `Promise.allSettled()` ensures all titles are attempted regardless of individual failures.

### Upload Errors (`src/routes/upload.js`)
- No file: 400 `{ error: 'No CSV file uploaded' }`
- No competitor name: 400 `{ error: 'Competitor name is required' }`
- Non-CSV file: multer fileFilter rejects with 400 `{ error: 'Only CSV files are allowed' }`
- File too large: multer's 10MB limit returns an error
- CSV parsing failure: Thrown by csvParser, caught by global error handler

### Auth Errors (`src/middleware/auth.js`)
- For AJAX/JSON/SSE requests (`Accept: application/json` or `text/event-stream`): returns `401 { error: 'Unauthorized' }`
- For browser page requests: redirects to `/login`

### Global Error Handler (`src/middleware/errorHandler.js`)
- Logs full stack trace to console via `console.error`.
- For AJAX/JSON/SSE requests: returns JSON `{ error: message }` with appropriate status code.
- For browser requests: renders an error page with status code, message, and a "Go back" link.

---

## 13. Known Issues / Important Notes

### Supabase Row Limits
- Supabase queries return a maximum of 1000 rows. The code handles this with pagination loops in `getResultsByJobId()` and `getPendingResults()`. If you add new queries that return many rows, you MUST implement the same pagination pattern.

### EasyParser Cloudflare Blocking
- EasyParser's endpoint is behind Cloudflare. Under certain conditions (IP reputation, rate), Cloudflare returns an HTML challenge page instead of JSON. The code detects this by checking the `content-type` header and throws a descriptive error. This typically manifests as a 502 ApiError.

### Session Expiry Returning HTML (Fixed)
- When a session expires, the `/upload` endpoint was returning an HTML redirect instead of JSON, causing the frontend `res.json()` call to fail. This was fixed by checking `res.redirected || res.status === 401` in the frontend before parsing JSON.

### Job Counter Race Conditions
- `incrementJobCounter()` performs a read-then-write (non-atomic). With `CONCURRENCY > 1`, counters may become slightly inaccurate. The `results` table is the source of truth for actual result data.

### Single-Process Queue
- The search queue runs in the same Node.js process as the web server. If the server restarts (deploy, crash), any in-progress job loses its queue state. The job status in the database will remain `processing` but no worker will pick it up. There is no mechanism to resume interrupted jobs automatically (though reconnecting to SSE will show the snapshot of whatever was completed).

### p-queue Version
- Uses `p-queue@6.6.2` (last CommonJS version). Version 7+ is ESM-only and would require converting the project to ESM or using dynamic `import()`.

### No Input Sanitization on Competitor Names
- Competitor names are stored as-is (trimmed). The lookup uses `.ilike()` (case-insensitive) to avoid duplicates, but there is no further validation or sanitization.

### Memory-Based File Upload
- `multer` uses memory storage. Uploaded CSV files (up to 10MB) are held in memory during processing. For very large files this could temporarily spike memory usage.

### No Pagination on Job History
- The dashboard fetches the last 20 jobs. There is no UI or API for viewing older jobs.

### EventEmitter Max Listeners
- Set to 50. If more than 50 clients simultaneously view progress for different jobs, Node will emit a warning. This is unlikely in a single-user app.

### RETRY_BASE_DELAY_MS
- This env var is not in `.env.example` but IS read in `config.js`. It controls the base delay for retry backoff.

---

## 14. Authentication

### How It Works
1. **Startup**: The admin password from `ADMIN_PASSWORD` env var is hashed with bcrypt (10 salt rounds) and stored in memory (`adminPasswordHash`).
2. **Login flow**:
   - User navigates to `/login` (or is redirected there by `requireAuth`).
   - Submits username + password via POST form.
   - Server checks username against `ADMIN_USERNAME` (default: `admin`).
   - Server verifies password against the bcrypt hash.
   - On success: `req.session.authenticated = true` and `req.session.username = username`, then redirect to `/`.
   - On failure: re-render login page with error message.
3. **Session**:
   - Uses `express-session` with cookie-based sessions.
   - Cookie `maxAge`: 24 hours.
   - `resave: false`, `saveUninitialized: false`.
   - Session secret from `SESSION_SECRET` env var.
   - **In-memory session store** (default). Sessions are lost on server restart. There is no persistent session store (e.g., Redis, database).
4. **Middleware** (`requireAuth`):
   - Checks `req.session.authenticated`.
   - If not authenticated:
     - AJAX/JSON/SSE requests get `401 { error: 'Unauthorized' }`.
     - Browser requests get redirected to `/login`.
5. **Logout**: POST to `/logout` destroys the session and redirects to `/login`.

### Security Notes
- Single admin user only. No user registration or role system.
- Password is stored as plaintext in the environment variable but hashed in memory at startup.
- Sessions use the default in-memory store, which does not scale to multiple instances and loses all sessions on restart.
- No CSRF protection is implemented.
- No rate limiting on login attempts.
