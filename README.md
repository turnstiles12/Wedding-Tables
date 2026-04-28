# 💍 Wedding Seating Chart

A self-hosted wedding seating chart app with a live SQLite database, admin panel, and guest-facing lookup page with QR code.

## Stack
- **Server:** Node.js + Express
- **Database:** SQLite (via sql.js — no native binaries needed)
- **Frontend:** Vanilla HTML/CSS/JS

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the server
node server.js

# 3. Open the admin panel
open http://localhost:3000/admin.html

# 4. Guest lookup page (share via QR)
open http://localhost:3000/guest.html
```

---

## Features

### Admin Panel (`/admin.html`)
- Add guests one by one (First, Last, Table)
- Bulk import via CSV (`First Name, Last Name, Table` format)
- Filter by table, search by name
- Live stats (total guests, tables, average per table)
- Auto-generated QR code pointing to the guest page
- Download QR as PNG for printing

### Guest Page (`/guest.html`)
- Type-ahead autocomplete search
- Instant table result fetched from the database
- Works on any phone via the QR code
- No login or account needed

---

## CSV Import Format

```
Jane,Smith,5
John,Doe,3
Emily,Johnson,7
```

No header row needed. Each line: `First Name, Last Name, Table Number`

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/guests` | All guests |
| GET | `/api/guests/search?q=name` | Autocomplete search |
| GET | `/api/guests/lookup?name=name` | Exact/partial lookup |
| POST | `/api/guests` | Add single guest |
| POST | `/api/guests/bulk` | Bulk import array |
| PUT | `/api/guests/:id` | Update guest |
| DELETE | `/api/guests/:id` | Remove guest |
| DELETE | `/api/guests` | Clear all guests |
| GET | `/api/stats` | Guest/table counts |

---

## Deploying Online (for public QR access)

To let guests access this from their own phones (not just on your local WiFi), deploy to a free host:

### Option A: Railway
1. Push this folder to a GitHub repo
2. Go to railway.app → New Project → Deploy from GitHub
3. It auto-detects Node.js. Done.
4. Copy the public URL → paste into the "Custom URL" field in the admin panel

### Option B: Render
1. Push to GitHub
2. render.com → New Web Service → Connect repo
3. Build command: `npm install`  Start command: `node server.js`

### Option C: Fly.io
```bash
npm install -g flyctl
fly launch
fly deploy
```

---

## Data Storage
- Database file: `data/wedding.db` (auto-created on first run)
- Persisted to disk after every write — survives server restarts
- Supports 500+ guests with no performance issues
