# NewVue Study Name Normalization — Migration

A production-grade NestJS + React TypeScript rewrite of the NewVue radiology study-name normalization service. Given a raw customer study name and imaging modality, the 5-phase pipeline normalizes the text, deterministically maps it to the NewVue enterprise catalogue, assigns CPT billing codes via LLM, and adjudicates the best match with a confidence classification.

> This directory is the active migration from the legacy Node.js/Express v1.4.0 implementation (`../NodeJS/`).

---

## What Was Updated from the Node.js Project

| Area | Node.js v1.4.0 (`../NodeJS/`) | NestJS Migration (this directory) |
|---|---|---|
| **Runtime framework** | Express 5 (unstructured) | NestJS 10 (modular, dependency injection) |
| **Language** | JavaScript (ES modules) | TypeScript 5 (strict mode) |
| **Request validation** | Manual checks | `class-validator` DTOs |
| **Frontend** | Static HTML served by Express | React 19 SPA (Vite) |
| **LLM phases** | Phases 3 & 5 as separate API calls | Combined into one GPT call (`combined-llm.ts`) — ~40% latency reduction |
| **Search index** | Rebuilt on every request | Pre-built `search-index-*.json` loaded at startup |
| **Tests** | Custom runner (`run-tests.js`) | Jest + Supertest (unit & E2E) |
| **Containerisation** | None | `docker-compose.yml` (backend + frontend) |

Core reference data (normalization rules, labeling lexicon, mapping engine, CPT catalogue) is shared between both implementations via the `backend/data/` directory.

---

## Features

- **5-phase normalization pipeline** — normalize → label → deterministic map → CPT assign → LLM adjudicate
- **8 imaging modalities** — CT, MR, US, XR, FL, MG, NM, IR
- **Deterministic matching** — label-overlap scoring across the NewVue enterprise catalogue (14M-entry `linkage-catalogue.json`)
- **CPT code assignment** — GPT-4o assigns CPT billing codes to both the customer study and each candidate match
- **Combined LLM call** — Phases 3 (CPT assignment) and 5 (adjudication) merged into a single structured OpenAI call
- **Confidence classification** — `HIGH CONFIDENCE`, `LOW CONFIDENCE`, or `PROGRAM FAILURE` based on CPT overlap (≥ 25% threshold) and LLM verdict
- **React 19 frontend** — real-time pipeline results, expandable phase-detail panels, colour-coded confidence badges
- **Type-safe REST API** — NestJS controllers with `class-validator` DTO enforcement
- **Automatic retry** — exponential back-off (up to 3 retries) on OpenAI API calls
- **Docker Compose** — single-command deployment of backend + frontend

---

## Prerequisites & Installation

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20 LTS or later |
| npm | 9+ |
| OpenAI API key | GPT-4o access required |
| Docker & Docker Compose *(optional)* | 24+ |

---

### Option A — Local Node.js (recommended for development)

#### 1. Backend (NestJS)

```bash
# From this directory (migration/)
cd backend

# Install dependencies
npm install

# Create the environment file from the example
cp .env.example .env
# Then edit .env and replace the placeholder with your real key:
# OPENAI_API_KEY=sk-...
# PORT=3000

# Development mode with hot reload
npm run start:dev

# — or — build and run in production mode
npm run build
npm start
```

The API will be available at `http://localhost:3000`.  
Reference data files in `backend/data/` are loaded on startup (< 200 ms).

#### 2. Frontend (React + Vite)

```bash
# In a separate terminal, from this directory (migration/)
cd frontend

npm install
npm run dev
```

The React app will be available at `http://localhost:5173` and proxies API calls to `:3000`.

---

### Option B — Docker Compose

```bash
# From this directory (migration/)

# Set your OpenAI key in backend/.env first:
# OPENAI_API_KEY=sk-...

docker-compose up --build
```

| Service | URL |
|---|---|
| Backend API | `http://localhost:3000` |
| Frontend (nginx) | `http://localhost:8090` |

---

## Tests

### Unit Tests (Jest)

```bash
cd backend
npm test
```

Tests live in `backend/test/` and cover:

| File | What it tests |
|---|---|
| `mapping.test.ts` | Deterministic mapping engine and label-overlap scoring |
| `cpt-matching.test.ts` | CPT similarity scoring and candidate ranking |
| `llm-adjudication.test.ts` | Confidence classification logic (`classifyConfidence`) |

Expected output:

```
PASS  test/mapping.test.ts
PASS  test/cpt-matching.test.ts
PASS  test/llm-adjudication.test.ts

Test Suites: 3 passed, 3 total
Tests:       N passed, N total
```

---

### End-to-End Tests (Supertest)

Boots the full NestJS app and makes real HTTP requests. Requires `OPENAI_API_KEY` to be set (live LLM calls).

```bash
cd backend
npm run test:e2e
```

E2E tests are in `backend/test/e2e/pipeline.e2e.test.ts`. Each test allows up to 30 seconds for LLM latency.

---

### Watch Mode

```bash
cd backend
npm run test:watch
```

---

### Testing with Postman

#### 1. Health Check

```
GET http://localhost:3000/api/health
```

Expected response (`200 OK`):

```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2026-06-01T00:00:00.000Z"
}
```

---

#### 2. Run Pipeline

```
POST http://localhost:3000/api/run-pipeline
Content-Type: application/json
```

Body:

```json
{
  "rawStudyName": "CT Head w/o contrast",
  "modality": "CT"
}
```

**Import this Postman collection via Postman → Import → Raw Text:**

```json
{
  "info": {
    "name": "NewVue Normalization API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Health Check",
      "request": {
        "method": "GET",
        "url": "http://localhost:3000/api/health"
      }
    },
    {
      "name": "Run Pipeline — CT Head",
      "request": {
        "method": "POST",
        "header": [{ "key": "Content-Type", "value": "application/json" }],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"rawStudyName\": \"CT Head w/o contrast\",\n  \"modality\": \"CT\"\n}"
        },
        "url": "http://localhost:3000/api/run-pipeline"
      }
    },
    {
      "name": "Run Pipeline — MRI Brain W and WO",
      "request": {
        "method": "POST",
        "header": [{ "key": "Content-Type", "value": "application/json" }],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"rawStudyName\": \"MRI BRAIN W AND WO\",\n  \"modality\": \"MR\"\n}"
        },
        "url": "http://localhost:3000/api/run-pipeline"
      }
    },
    {
      "name": "Run Pipeline — US Abdomen Complete",
      "request": {
        "method": "POST",
        "header": [{ "key": "Content-Type", "value": "application/json" }],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"rawStudyName\": \"US ABDOMEN COMPLETE\",\n  \"modality\": \"US\"\n}"
        },
        "url": "http://localhost:3000/api/run-pipeline"
      }
    },
    {
      "name": "Run Pipeline — XR Chest PA and Lateral",
      "request": {
        "method": "POST",
        "header": [{ "key": "Content-Type", "value": "application/json" }],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"rawStudyName\": \"XR CHEST PA AND LATERAL\",\n  \"modality\": \"XR\"\n}"
        },
        "url": "http://localhost:3000/api/run-pipeline"
      }
    }
  ]
}
```

---

## API Reference

Base URL: `http://localhost:3000`

---

### `GET /api/health`

Returns server health and API version.

**Response `200 OK`:**

```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2026-06-01T12:34:56.789Z"
}
```

---

### `POST /api/run-pipeline`

Runs the full 5-phase normalization pipeline for a single study name.

**Request body** (`application/json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `rawStudyName` | `string` | Yes | Customer study name as-is (e.g. `"CT Head w/o contrast"`) |
| `modality` | `string` | Yes | One of `CT`, `MR`, `US`, `XR`, `FL`, `MG`, `NM`, `IR` |

**Example request:**

```json
{
  "rawStudyName": "CT Head w/o contrast",
  "modality": "CT"
}
```

**Response `200 OK`:**

```json
{
  "success": true,
  "elapsedMs": 9240,
  "result": {
    "rawStudyName": "CT Head w/o contrast",
    "normalizedStudyName": "CT HEAD WITHOUT CONTRAST",
    "modality": "CT",
    "confidence": "HIGH CONFIDENCE",
    "explanation": "CT Head without Contrast maps directly to the enterprise entry with 100% deterministic confidence and matching CPT codes.",
    "bestMatch": {
      "enterpriseName": "CT Head without Contrast",
      "matchNumber": 1,
      "source": "deterministic"
    },
    "deterministicConfidence": 1.0,
    "cptScore": 1.0,
    "llmAdjudication": "Good",
    "labels": {
      "modality": ["CT"],
      "region": ["HEAD"],
      "contrast": ["WITHOUT CONTRAST"],
      "laterality": [],
      "angiography": [],
      "rvu_modifier": [],
      "qualifier": []
    },
    "customerCpt": {
      "codes": ["70450"],
      "modifiers": []
    },
    "topDeterministicMatches": [
      {
        "enterpriseName": "CT Head without Contrast",
        "deterministicConfidence": 1.0,
        "cptCodes": ["70450"],
        "cptModifiers": [],
        "cptScore": 1.0
      }
    ],
    "topCptMatches": [
      {
        "enterpriseName": "CT Head without Contrast",
        "cptCodes": ["70450"],
        "cptModifiers": [],
        "cptScore": 1.0
      }
    ]
  }
}
```

**Confidence values:**

| Value | Meaning |
|---|---|
| `HIGH CONFIDENCE` | LLM verdict is acceptable **and** CPT overlap ≥ 25%, **or** deterministic match #1–3 with 100% label score |
| `LOW CONFIDENCE` | Match found but confidence criteria not met |
| `PROGRAM FAILURE` | Pipeline error — LLM unreachable, invalid JSON response, or unhandled exception |

**`400 Bad Request`** — invalid input:

```json
{
  "statusCode": 400,
  "message": ["modality must be one of: CT, MR, US, XR, FL, MG, NM, IR"],
  "error": "Bad Request"
}
```

**`500 Internal Server Error`** — pipeline failure:

```json
{
  "success": false,
  "error": "OpenAI API returned invalid JSON",
  "result": {
    "rawStudyName": "CT Head w/o contrast",
    "normalizedStudyName": "CT Head w/o contrast",
    "modality": "CT",
    "confidence": "Program Failure",
    "explanation": "Server error: OpenAI API returned invalid JSON",
    "bestMatch": { "enterpriseName": "", "matchNumber": 0, "source": "error" }
  }
}
```

---

## Environment Variables

Configured via `backend/.env` (copy from `backend/.env.example`):

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | — | OpenAI API key with GPT-4o access |
| `PORT` | No | `3000` | Port the NestJS server listens on |

---

## Project Structure

```
migration/
├── backend/                        # NestJS API (v1.0.0)
│   ├── src/
│   │   ├── pipeline/
│   │   │   ├── core/               # normalize, label, map, CPT, combined LLM logic
│   │   │   ├── dto/                # RunPipelineDto (class-validator)
│   │   │   ├── pipeline.controller.ts
│   │   │   └── pipeline.service.ts
│   │   ├── health/
│   │   │   └── health.controller.ts
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── test/
│   │   ├── mapping.test.ts
│   │   ├── cpt-matching.test.ts
│   │   ├── llm-adjudication.test.ts
│   │   └── e2e/
│   │       └── pipeline.e2e.test.ts
│   ├── data/                       # Reference JSON (lexicons, catalogues, index)
│   ├── .env.example
│   ├── Dockerfile
│   └── package.json
├── frontend/                       # React 19 + Vite SPA
│   ├── src/
│   │   ├── App.tsx
│   │   └── App.module.css
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
└── docker-compose.yml
```

---

## Troubleshooting

**`PROGRAM FAILURE` result**  
Verify `OPENAI_API_KEY` in `backend/.env` is valid and has sufficient quota. Check the backend terminal for the raw error. The pipeline retries up to 3 times with exponential back-off.

**Server won't start**  
Run `npm install` inside `backend/` first. If port 3000 is already in use, set `PORT=8080` in `.env`.

**No deterministic matches**  
Check the `labels` field in the response. Words the labeling lexicon does not recognise will not contribute to matching — they may need to be added to `backend/data/labeling-lexicon.json`.

**Low CPT scores across all matches**  
Inspect `customerCpt.codes` in the response. If the LLM assigned an unexpected code, the study may not have a close match in the NewVue catalogue (novel procedure or specialized protocol).
