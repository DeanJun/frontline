const { Pool } = require('pg');

const pool = new Pool({
  user: 'frontline',
  host: 'localhost',
  database: 'frontline_db',
  password: 'frontline1234',
  port: 5432,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rankings (
      id SERIAL PRIMARY KEY,
      nickname VARCHAR(32) NOT NULL,
      distance INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function saveRanking(nickname, distance) {
  await pool.query(
    'INSERT INTO rankings (nickname, distance) VALUES ($1, $2)',
    [nickname, distance]
  );
  const result = await pool.query(
    'SELECT COUNT(*) + 1 AS rank FROM rankings WHERE distance > $1',
    [distance]
  );
  return parseInt(result.rows[0].rank);
}

async function getRankings() {
  const result = await pool.query(
    'SELECT nickname, distance, created_at FROM rankings ORDER BY distance DESC LIMIT 100'
  );
  return result.rows.map((r, i) => ({
    rank: i + 1,
    nickname: r.nickname,
    distance: r.distance,
    date: r.created_at,
  }));
}

module.exports = { init, saveRanking, getRankings };
