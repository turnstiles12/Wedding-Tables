const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const app = express();
const PORT = 3000;
const DB_PATH = path.join(__dirname, 'data', 'wedding.db');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

let db;

async function initDB() {
  const SQL = await initSqlJs();

  // Load existing DB from disk, or create new
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('📂 Loaded existing database.');
  } else {
    db = new SQL.Database();
    console.log('✨ Created new database.');
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS guests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      table_number INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  persistDB();
}

// Write db to disk after every write operation
function persistDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────

// GET all guests
app.get('/api/guests', (req, res) => {
  try {
    const stmt = db.prepare('SELECT id, name, table_number FROM guests ORDER BY table_number, name');
    const guests = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      guests.push(row);
    }
    stmt.free();
    res.json({ guests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET search guests by name
app.get('/api/guests/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ guests: [] });

  try {
    const stmt = db.prepare(
      `SELECT id, name, table_number FROM guests
       WHERE name LIKE ? COLLATE NOCASE
       ORDER BY table_number, name
       LIMIT 10`
    );
    stmt.bind([`%${q}%`]);
    const guests = [];
    while (stmt.step()) {
      guests.push(stmt.getAsObject());
    }
    stmt.free();
    res.json({ guests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET exact lookup (for guest page)
app.get('/api/guests/lookup', (req, res) => {
  const name = (req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });

  try {
    // Try exact match first, then partial
    let stmt = db.prepare(
      `SELECT id, name, table_number FROM guests WHERE name = ? COLLATE NOCASE LIMIT 1`
    );
    stmt.bind([name]);
    let guest = null;
    if (stmt.step()) guest = stmt.getAsObject();
    stmt.free();

    if (!guest) {
      stmt = db.prepare(
        `SELECT id, name, table_number FROM guests WHERE name LIKE ? COLLATE NOCASE LIMIT 1`
      );
      stmt.bind([`%${name}%`]);
      if (stmt.step()) guest = stmt.getAsObject();
      stmt.free();
    }

    if (!guest) return res.json({ found: false });
    res.json({ found: true, guest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST add single guest
app.post('/api/guests', (req, res) => {
  const { name, table_number } = req.body;
  if (!name || !table_number) {
    return res.status(400).json({ error: 'Name and table_number required' });
  }

  const trimmedName = name.trim();
  const tableNum = parseInt(table_number);
  if (!trimmedName || isNaN(tableNum) || tableNum < 1) {
    return res.status(400).json({ error: 'Invalid name or table number' });
  }

  try {
    db.run(
      'INSERT INTO guests (name, table_number) VALUES (?, ?)',
      [trimmedName, tableNum]
    );
    persistDB();

    const stmt = db.prepare('SELECT id, name, table_number FROM guests WHERE name = ? COLLATE NOCASE');
    stmt.bind([trimmedName]);
    const guest = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();

    res.status(201).json({ guest });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: `"${trimmedName}" is already in the guest list.` });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST bulk import
app.post('/api/guests/bulk', (req, res) => {
  const { guests } = req.body;
  if (!Array.isArray(guests) || !guests.length) {
    return res.status(400).json({ error: 'guests array required' });
  }

  let added = 0;
  let skipped = 0;
  const errors = [];

  try {
    db.run('BEGIN TRANSACTION');

    for (const g of guests) {
      const name = (g.name || '').trim();
      const table_number = parseInt(g.table_number);
      if (!name || isNaN(table_number) || table_number < 1) {
        skipped++;
        continue;
      }
      try {
        db.run('INSERT INTO guests (name, table_number) VALUES (?, ?)', [name, table_number]);
        added++;
      } catch (e) {
        if (e.message.includes('UNIQUE')) skipped++;
        else errors.push(`${name}: ${e.message}`);
      }
    }

    db.run('COMMIT');
    persistDB();
    res.json({ added, skipped, errors });
  } catch (err) {
    db.run('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// PUT update guest
app.put('/api/guests/:id', (req, res) => {
  const { id } = req.params;
  const { name, table_number } = req.body;

  try {
    db.run(
      'UPDATE guests SET name = ?, table_number = ? WHERE id = ?',
      [name.trim(), parseInt(table_number), parseInt(id)]
    );
    persistDB();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE single guest
app.delete('/api/guests/:id', (req, res) => {
  try {
    db.run('DELETE FROM guests WHERE id = ?', [parseInt(req.params.id)]);
    persistDB();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE all guests
app.delete('/api/guests', (req, res) => {
  try {
    db.run('DELETE FROM guests');
    persistDB();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET stats
app.get('/api/stats', (req, res) => {
  try {
    const r = db.exec(`
      SELECT
        COUNT(*) as total_guests,
        COUNT(DISTINCT table_number) as total_tables
      FROM guests
    `);
    const row = r[0]?.values[0] || [0, 0];
    const [total_guests, total_tables] = row;
    const avg = total_tables > 0 ? Math.round((total_guests / total_tables) * 10) / 10 : 0;
    res.json({ total_guests, total_tables, avg_per_table: avg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catch-all: serve index
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ─── START ────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🌸 Wedding Seating Server running at http://localhost:${PORT}`);
    console.log(`   Admin panel : http://localhost:${PORT}/admin.html`);
    console.log(`   Guest page  : http://localhost:${PORT}/guest.html\n`);
  });
});
