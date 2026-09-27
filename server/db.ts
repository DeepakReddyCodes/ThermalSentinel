import { Pool } from 'pg';

let pool: Pool | null = null;

export function getDbPool(): Pool | null {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });
  }
  return pool;
}

export async function initDatabaseSchema() {
  const db = getDbPool();
  if (!db) {
    console.log('[Database] No DATABASE_URL set; using file-backed storage.');
    return false;
  }

  try {
    // 1. Ensure PostGIS is enabled
    await db.query('CREATE EXTENSION IF NOT EXISTS postgis;');

    // 2. Create thermal_observations table
    await db.query(`
      CREATE TABLE IF NOT EXISTS thermal_observations (
        id VARCHAR(100) PRIMARY KEY,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        geom GEOMETRY(Point, 4326),
        acquisition_time TIMESTAMPTZ NOT NULL,
        satellite VARCHAR(50) NOT NULL,
        sensor VARCHAR(50) NOT NULL,
        frp DOUBLE PRECISION NOT NULL,
        brightness_kelvin DOUBLE PRECISION NOT NULL,
        confidence VARCHAR(20) NOT NULL,
        day_night CHAR(1) NOT NULL,
        scan DOUBLE PRECISION,
        track DOUBLE PRECISION,
        is_historical BOOLEAN DEFAULT FALSE,
        associated_facility_id VARCHAR(100),
        association_type VARCHAR(50),
        matched_zone_id VARCHAR(100),
        distance_to_zone_meters DOUBLE PRECISION,
        distance_to_facility_meters DOUBLE PRECISION,
        raw_payload JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 3. Create index on geom and facility
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_obs_geom ON thermal_observations USING GIST (geom);
      CREATE INDEX IF NOT EXISTS idx_obs_facility ON thermal_observations (associated_facility_id);
      CREATE INDEX IF NOT EXISTS idx_obs_acq_time ON thermal_observations (acquisition_time);
    `);

    // 4. Create facility_baselines table
    await db.query(`
      CREATE TABLE IF NOT EXISTS facility_baselines (
        facility_id VARCHAR(100) PRIMARY KEY,
        facility_name VARCHAR(255) NOT NULL,
        baseline_period_start DATE NOT NULL,
        baseline_period_end DATE NOT NULL,
        total_observations INTEGER NOT NULL,
        observation_days INTEGER NOT NULL,
        observations_per_day DOUBLE PRECISION NOT NULL,
        frp_median DOUBLE PRECISION NOT NULL,
        frp_p25 DOUBLE PRECISION NOT NULL,
        frp_p75 DOUBLE PRECISION NOT NULL,
        frp_p90 DOUBLE PRECISION NOT NULL,
        frp_p95 DOUBLE PRECISION NOT NULL,
        frp_max DOUBLE PRECISION NOT NULL,
        frp_mad DOUBLE PRECISION NOT NULL,
        day_count INTEGER NOT NULL,
        night_count INTEGER NOT NULL,
        hour_distribution JSONB NOT NULL,
        zone_distributions JSONB NOT NULL,
        baseline_status VARCHAR(50) NOT NULL,
        provenance VARCHAR(100) NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 5. Create historical_firms_raw view/table aliasing thermal_observations
    await db.query(`
      CREATE OR REPLACE VIEW historical_firms_raw AS 
      SELECT * FROM thermal_observations;
    `);

    console.log('[Database] PostgreSQL and PostGIS schema initialized successfully.');
    return true;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Database] Schema initialization warning:', errorMsg);
    return false;
  }
}
