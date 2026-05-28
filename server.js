const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Database connection ────────────────────────────────────────
// Railway automatically sets DATABASE_URL when you add a PostgreSQL service
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guests (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      table_number INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ Database ready.');
}

// ── ROUTES ─────────────────────────────────────────────────────

// GET all guests
app.get('/api/guests', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, table_number FROM guests ORDER BY table_number, name'
    );
    res.json({ guests: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET search guests by name (autocomplete)
app.get('/api/guests/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ guests: [] });

  try {
    const result = await pool.query(
      `SELECT id, name, table_number FROM guests
       WHERE name ILIKE $1
       ORDER BY table_number, name
       LIMIT 10`,
      [`%${q}%`]
    );
    res.json({ guests: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET exact lookup (for guest page)
app.get('/api/guests/lookup', async (req, res) => {
  const name = (req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });

  try {
    // Try exact match first
    let result = await pool.query(
      'SELECT id, name, table_number FROM guests WHERE name ILIKE $1 LIMIT 1',
      [name]
    );

    // Fall back to partial match
    if (!result.rows.length) {
      result = await pool.query(
        'SELECT id, name, table_number FROM guests WHERE name ILIKE $1 LIMIT 1',
        [`%${name}%`]
      );
    }

    if (!result.rows.length) return res.json({ found: false });
    res.json({ found: true, guest: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST add single guest
app.post('/api/guests', async (req, res) => {
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
    const result = await pool.query(
      'INSERT INTO guests (name, table_number) VALUES ($1, $2) RETURNING id, name, table_number',
      [trimmedName, tableNum]
    );
    res.status(201).json({ guest: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `"${trimmedName}" is already in the guest list.` });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST bulk import
app.post('/api/guests/bulk', async (req, res) => {
  const { guests } = req.body;
  if (!Array.isArray(guests) || !guests.length) {
    return res.status(400).json({ error: 'guests array required' });
  }

  // Pre-validate and deduplicate on the server side before touching the DB
  const seen = new Set();
  const valid = [];
  let skipped = 0;

  for (const g of guests) {
    const name = (g.name || '').trim();
    const table_number = parseInt(g.table_number);
    if (!name || isNaN(table_number) || table_number < 1) { skipped++; continue; }
    if (seen.has(name.toLowerCase())) { skipped++; continue; } // dedupe within the CSV itself
    seen.add(name.toLowerCase());
    valid.push({ name, table_number });
  }

  if (!valid.length) {
    return res.json({ added: 0, skipped, errors: [] });
  }

  // Single-query bulk insert using UNNEST — one round-trip regardless of guest count
  const names        = valid.map(g => g.name);
  const tableNumbers = valid.map(g => g.table_number);

  try {
    const result = await pool.query(
      `INSERT INTO guests (name, table_number)
       SELECT * FROM UNNEST($1::text[], $2::int[])
       ON CONFLICT (name) DO NOTHING
       RETURNING id`,
      [names, tableNumbers]
    );

    const added = result.rowCount;
    skipped += (valid.length - added); // rows that hit ON CONFLICT

    res.json({ added, skipped, errors: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update guest
app.put('/api/guests/:id', async (req, res) => {
  const { name, table_number } = req.body;
  try {
    await pool.query(
      'UPDATE guests SET name = $1, table_number = $2 WHERE id = $3',
      [name.trim(), parseInt(table_number), parseInt(req.params.id)]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE single guest
app.delete('/api/guests/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM guests WHERE id = $1', [parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE all guests
app.delete('/api/guests', async (req, res) => {
  try {
    await pool.query('DELETE FROM guests');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET stats
app.get('/api/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total_guests,
        COUNT(DISTINCT table_number) AS total_tables
      FROM guests
    `);
    const { total_guests, total_tables } = result.rows[0];
    const avg = total_tables > 0
      ? Math.round((total_guests / total_tables) * 10) / 10
      : 0;
    res.json({
      total_guests: parseInt(total_guests),
      total_tables: parseInt(total_tables),
      avg_per_table: avg
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catch-all: serve admin page
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── START ──────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🌸 Wedding Seating Server running on port ${PORT}`);
    console.log(`   Admin : http://localhost:${PORT}/admin.html`);
    console.log(`   Guest : http://localhost:${PORT}/guest.html\n`);
  });
}).catch(err => {
  console.error('❌ Failed to connect to database:', err.message);
  console.error('Make sure DATABASE_URL is set in your environment variables.');
  process.exit(1);
});