import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';

let dbInstance: Database | null = null;
const DB_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'trading_analyst.sqlite');

export async function getDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    const fileBuffer = fs.readFileSync(DB_FILE);
    dbInstance = new SQL.Database(fileBuffer);
    // Always run schema migrations against existing databases so newly added
    // SQLite-only persistence tables are available without manual reset.
    initSchema(dbInstance);
    seedInitialData(dbInstance);
    persistDatabase();
  } else {
    dbInstance = new SQL.Database();
    initSchema(dbInstance);
    seedInitialData(dbInstance);
    persistDatabase();
  }

  return dbInstance;
}

export function persistDatabase(): void {
  if (!dbInstance) return;
  try {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_FILE, buffer);
  } catch (err) {
    console.error('Error persisting SQLite database to disk:', err);
  }
}

function initSchema(db: Database) {
  const schemaSQL = `
    -- 1. Users
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT,
      created_at INTEGER NOT NULL
    );

    -- 2. Markets
    CREATE TABLE IF NOT EXISTS markets (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      currency TEXT NOT NULL
    );

    -- 3. Instruments
    CREATE TABLE IF NOT EXISTS instruments (
      id TEXT PRIMARY KEY,
      symbol TEXT UNIQUE NOT NULL,
      market_id TEXT NOT NULL,
      tick_size REAL NOT NULL,
      lot_size REAL NOT NULL
    );

    -- 4. Currency Pairs
    CREATE TABLE IF NOT EXISTS currency_pairs (
      symbol TEXT PRIMARY KEY,
      base_currency TEXT NOT NULL,
      quote_currency TEXT NOT NULL,
      pip_size REAL NOT NULL,
      digits INTEGER NOT NULL,
      typical_spread REAL NOT NULL
    );

    -- 5. Underlyings
    CREATE TABLE IF NOT EXISTS underlyings (
      symbol TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      exchange TEXT NOT NULL,
      strike_step REAL NOT NULL,
      lot_size INTEGER NOT NULL,
      tick_size REAL NOT NULL,
      standard_expiry_day TEXT NOT NULL
    );

    -- 6. Contracts
    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      underlying TEXT NOT NULL,
      expiry TEXT NOT NULL,
      strike REAL NOT NULL,
      option_type TEXT NOT NULL,
      lot_size INTEGER NOT NULL
    );

    -- 7. Market Data
    CREATE TABLE IF NOT EXISTS market_data (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      price REAL NOT NULL,
      volume REAL,
      data_status TEXT NOT NULL
    );

    -- 8. Candles
    CREATE TABLE IF NOT EXISTS candles (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      oi REAL,
      vwap REAL
    );

    -- 9. Technical Features
    CREATE TABLE IF NOT EXISTS technical_features (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      rsi REAL,
      ema9 REAL,
      ema21 REAL,
      ema50 REAL,
      ema200 REAL,
      atr REAL,
      vwap REAL
    );

    -- 10. Options Chain
    CREATE TABLE IF NOT EXISTS options_chain (
      id TEXT PRIMARY KEY,
      underlying TEXT NOT NULL,
      expiry TEXT NOT NULL,
      spot_price REAL NOT NULL,
      pcr REAL NOT NULL,
      timestamp INTEGER NOT NULL
    );

    -- 11. Option Contracts
    CREATE TABLE IF NOT EXISTS option_contracts (
      id TEXT PRIMARY KEY,
      chain_id TEXT NOT NULL,
      strike REAL NOT NULL,
      option_type TEXT NOT NULL,
      ltp REAL NOT NULL,
      oi REAL NOT NULL,
      change_oi REAL NOT NULL,
      volume REAL NOT NULL,
      iv REAL NOT NULL
    );

    -- 12. Greeks
    CREATE TABLE IF NOT EXISTS greeks (
      contract_id TEXT PRIMARY KEY,
      delta REAL NOT NULL,
      gamma REAL NOT NULL,
      theta REAL NOT NULL,
      vega REAL NOT NULL,
      rho REAL NOT NULL,
      iv REAL NOT NULL,
      model_derived INTEGER NOT NULL
    );

    -- 13. Signals
    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      market TEXT NOT NULL,
      instrument TEXT NOT NULL,
      pair TEXT,
      timeframe TEXT,
      underlying TEXT,
      direction TEXT NOT NULL,
      category TEXT NOT NULL,
      strategy TEXT NOT NULL,
      score REAL NOT NULL,
      ml_probability REAL,
      entry_preferred REAL NOT NULL,
      entry_min REAL,
      entry_max REAL,
      stop_loss REAL NOT NULL,
      target1 REAL NOT NULL,
      target2 REAL NOT NULL,
      target3 REAL,
      risk_reward REAL NOT NULL,
      trend TEXT,
      market_regime TEXT,
      session TEXT,
      status TEXT NOT NULL,
      data_status TEXT,
      strategy_version TEXT,
      model_version TEXT NOT NULL
    );

    -- 14. Signal Events
    CREATE TABLE IF NOT EXISTS signal_events (
      id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      notes TEXT
    );

    -- 15. Trades
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      signal_id TEXT,
      instrument TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      exit_price REAL,
      size REAL NOT NULL,
      pnl REAL,
      status TEXT NOT NULL,
      entry_time INTEGER NOT NULL,
      exit_time INTEGER
    );

    -- 16. Positions
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      instrument TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      current_price REAL NOT NULL,
      quantity REAL NOT NULL,
      unrealized_pnl REAL NOT NULL,
      stop_loss REAL,
      take_profit REAL
    );

    -- 17. Orders
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      instrument TEXT NOT NULL,
      order_type TEXT NOT NULL,
      direction TEXT NOT NULL,
      price REAL,
      quantity REAL NOT NULL,
      status TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    -- 19. Economic Events
    CREATE TABLE IF NOT EXISTS economic_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      currency TEXT NOT NULL,
      impact TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      blocks_entry INTEGER NOT NULL
    );

    -- 20. Model Versions
    CREATE TABLE IF NOT EXISTS model_versions (
      id TEXT PRIMARY KEY,
      market TEXT NOT NULL,
      model_name TEXT NOT NULL,
      version TEXT NOT NULL,
      trained_at INTEGER NOT NULL,
      status TEXT NOT NULL
    );

    -- 21. Model Predictions
    CREATE TABLE IF NOT EXISTS model_predictions (
      id TEXT PRIMARY KEY,
      model_version_id TEXT NOT NULL,
      instrument TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      predicted_class TEXT NOT NULL,
      probability REAL NOT NULL
    );

    -- 22. Backtest Runs
    CREATE TABLE IF NOT EXISTS backtest_runs (
      id TEXT PRIMARY KEY,
      strategy_name TEXT NOT NULL,
      market TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      total_trades INTEGER NOT NULL,
      win_rate REAL NOT NULL,
      profit_factor REAL NOT NULL
    );

    -- 23. Backtest Trades
    CREATE TABLE IF NOT EXISTS backtest_trades (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      instrument TEXT NOT NULL,
      pnl REAL NOT NULL,
      return_pct REAL NOT NULL
    );

    -- 24. Strategy Configs
    CREATE TABLE IF NOT EXISTS strategy_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      market TEXT NOT NULL,
      is_enabled INTEGER NOT NULL,
      min_score REAL NOT NULL,
      min_rr REAL NOT NULL
    );

    -- 25. Broker Accounts
    CREATE TABLE IF NOT EXISTS broker_accounts (
      id TEXT PRIMARY KEY,
      broker TEXT NOT NULL,
      environment TEXT NOT NULL,
      account_id TEXT NOT NULL,
      account_type TEXT NOT NULL,
      balance REAL NOT NULL,
      equity REAL NOT NULL,
      available_margin REAL NOT NULL,
      used_margin REAL NOT NULL,
      free_margin REAL NOT NULL,
      currency TEXT NOT NULL,
      connection_status TEXT NOT NULL,
      server TEXT,
      permissions_json TEXT,
      last_update INTEGER NOT NULL,
      is_live_account INTEGER NOT NULL DEFAULT 0,
      UNIQUE(broker, environment, account_id)
    );

    -- 26. Trade Trace Roots
    CREATE TABLE IF NOT EXISTS trade_traces (
      trade_trace_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- 27. Trade Trace Lifecycle Nodes
    CREATE TABLE IF NOT EXISTS trade_trace_nodes (
      node_id TEXT PRIMARY KEY,
      trade_trace_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    -- 28. Trade Notes
    CREATE TABLE IF NOT EXISTS trade_notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      symbol TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Broker reconciliation snapshots
    CREATE TABLE IF NOT EXISTS broker_reconciliation_snapshots (
      id TEXT PRIMARY KEY,
      broker TEXT NOT NULL,
      environment TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      account_json TEXT,
      positions_json TEXT NOT NULL,
      orders_json TEXT NOT NULL,
      status TEXT NOT NULL
    );

    -- 30. Autonomous Execution Idempotency
    CREATE TABLE IF NOT EXISTS execution_intents (
      idempotency_key TEXT PRIMARY KEY,
      claim_token TEXT NOT NULL,
      broker TEXT NOT NULL,
      market TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      state TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      result_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    -- 30.1. Durable execution fill observations
    CREATE TABLE IF NOT EXISTS execution_fill_observations (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL,
      broker TEXT NOT NULL,
      broker_order_id TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_quantity REAL,
      filled_quantity REAL NOT NULL,
      remaining_quantity REAL,
      average_fill_price REAL,
      commission REAL,
      observed_at INTEGER NOT NULL
    );

    -- 30.2. Broker-native execution fill event ledger
    -- Each broker fill/deal is stored once by its broker-native execution ID.
    CREATE TABLE IF NOT EXISTS execution_fill_events (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL,
      broker TEXT NOT NULL,
      broker_order_id TEXT NOT NULL,
      broker_fill_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      commission REAL,
      executed_at INTEGER NOT NULL,
      observed_at INTEGER NOT NULL,
      UNIQUE(broker, broker_order_id, broker_fill_id)
    );

    -- 30. ML Persistence Bridge
    CREATE TABLE IF NOT EXISTS ml_storage_records (
      id TEXT PRIMARY KEY,
      record_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    -- 31. Unified Prediction & Evidence Ledger (Phase 17)
    CREATE TABLE IF NOT EXISTS predictions (
      prediction_id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      pair TEXT NOT NULL,
      horizon TEXT NOT NULL,
      direction TEXT NOT NULL,
      probability_up REAL NOT NULL,
      probability_down REAL NOT NULL,
      confidence REAL NOT NULL,
      regime TEXT NOT NULL,
      technical_features TEXT NOT NULL,
      news_features TEXT NOT NULL,
      historical_features TEXT NOT NULL,
      sample_size INTEGER NOT NULL,
      expected_return REAL NOT NULL,
      expected_risk REAL NOT NULL,
      recommendation TEXT NOT NULL,
      target_price REAL,
      actual_price REAL,
      actual_outcome TEXT NOT NULL DEFAULT 'PENDING',
      actual_return REAL,
      win_loss INTEGER,
      prediction_error REAL,
      created_at INTEGER NOT NULL,
      evaluated_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_predictions_pair_ts ON predictions(pair, timestamp);
    CREATE INDEX IF NOT EXISTS idx_predictions_recommendation ON predictions(recommendation);
    CREATE INDEX IF NOT EXISTS idx_predictions_outcome ON predictions(actual_outcome);

    -- 32. Forensic Immutable Prediction Snapshots (Phase 2 & 16)
    CREATE TABLE IF NOT EXISTS prediction_snapshots (
      prediction_id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      pair TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      horizon TEXT NOT NULL,
      model_id TEXT NOT NULL,
      model_version TEXT NOT NULL,
      feature_version TEXT NOT NULL,
      regime_version TEXT NOT NULL,
      news_engine_version TEXT NOT NULL,
      predicted_direction TEXT NOT NULL,
      prediction_class TEXT NOT NULL,
      prob_target_first REAL NOT NULL,
      prob_stop_first REAL NOT NULL,
      prob_time_exit REAL NOT NULL,
      expected_r REAL NOT NULL,
      confidence_tier TEXT NOT NULL,
      confidence_score REAL NOT NULL,
      prediction_horizon_candles INTEGER NOT NULL,
      predicted_entry REAL NOT NULL,
      predicted_stop_loss REAL NOT NULL,
      predicted_take_profit REAL NOT NULL,
      predicted_risk_reward REAL NOT NULL,
      predicted_position_size REAL NOT NULL,
      spread_at_prediction REAL NOT NULL,
      bid REAL NOT NULL,
      ask REAL NOT NULL,
      mid_price REAL NOT NULL,
      atr REAL NOT NULL,
      atr_pips REAL NOT NULL,
      volatility REAL NOT NULL,
      market_regime TEXT NOT NULL,
      trend_strength REAL NOT NULL,
      market_structure TEXT NOT NULL,
      dist_to_support_pips REAL NOT NULL,
      dist_to_resistance_pips REAL NOT NULL,
      session TEXT NOT NULL,
      deterministic_signal TEXT NOT NULL,
      deterministic_score REAL NOT NULL,
      ml_score REAL NOT NULL,
      trade_quality_score REAL NOT NULL,
      final_decision TEXT NOT NULL,
      news_risk TEXT NOT NULL,
      high_impact_news INTEGER NOT NULL,
      elevated_news INTEGER NOT NULL,
      news_sentiment REAL NOT NULL,
      news_shock_state INTEGER NOT NULL,
      relevant_news_count INTEGER NOT NULL,
      top_contributing_features TEXT NOT NULL,
      conflicting_factors TEXT NOT NULL,
      quote_age_ms INTEGER NOT NULL,
      data_quality TEXT NOT NULL,
      spread_quality TEXT NOT NULL,
      missing_feature_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_psnap_pair_ts ON prediction_snapshots(pair, timestamp);
    CREATE INDEX IF NOT EXISTS idx_psnap_model_ver ON prediction_snapshots(model_version);
    CREATE INDEX IF NOT EXISTS idx_psnap_regime ON prediction_snapshots(market_regime);
    CREATE INDEX IF NOT EXISTS idx_psnap_session ON prediction_snapshots(session);
    CREATE INDEX IF NOT EXISTS idx_psnap_decision ON prediction_snapshots(final_decision);

    -- 33. Forensic Feature Snapshots (Phase 2 & 16)
    CREATE TABLE IF NOT EXISTS prediction_feature_snapshots (
      prediction_id TEXT PRIMARY KEY,
      rsi REAL NOT NULL,
      macd REAL NOT NULL,
      macd_signal REAL NOT NULL,
      macd_histogram REAL NOT NULL,
      ema9 REAL NOT NULL,
      ema21 REAL NOT NULL,
      ema50 REAL NOT NULL,
      ema200 REAL NOT NULL,
      adx REAL NOT NULL,
      di_plus REAL NOT NULL,
      di_minus REAL NOT NULL,
      bollinger_upper REAL NOT NULL,
      bollinger_lower REAL NOT NULL,
      bollinger_width REAL NOT NULL,
      stochastic_k REAL NOT NULL,
      stochastic_d REAL NOT NULL,
      roc REAL NOT NULL,
      vwap_distance REAL NOT NULL,
      mtf_alignment TEXT NOT NULL,
      mtf_conflict_score REAL NOT NULL
    );

    -- 34. Forensic Prediction Outcomes (Phase 3 & 16)
    CREATE TABLE IF NOT EXISTS prediction_outcomes (
      prediction_id TEXT PRIMARY KEY,
      evaluated_at INTEGER NOT NULL,
      actual_outcome TEXT NOT NULL,
      trade_classification TEXT NOT NULL,
      is_direction_correct INTEGER NOT NULL,
      is_trade_won INTEGER NOT NULL,
      entry_reached INTEGER NOT NULL,
      entry_price_actual REAL,
      exit_price_actual REAL,
      actual_realized_r REAL NOT NULL,
      holding_duration_minutes REAL NOT NULL,
      mae_pips REAL NOT NULL,
      mfe_pips REAL NOT NULL,
      mae_r REAL NOT NULL,
      mfe_r REAL NOT NULL,
      closed_by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_poutcome_eval_ts ON prediction_outcomes(evaluated_at);
    CREATE INDEX IF NOT EXISTS idx_poutcome_outcome ON prediction_outcomes(actual_outcome);
    CREATE INDEX IF NOT EXISTS idx_poutcome_trade_class ON prediction_outcomes(trade_classification);

    -- 35. Forensic Root Cause Audits (Phase 7 & 16)
    CREATE TABLE IF NOT EXISTS prediction_forensics (
      prediction_id TEXT PRIMARY KEY,
      primary_failure_reason TEXT NOT NULL,
      secondary_factors TEXT NOT NULL,
      evidence_summary TEXT NOT NULL,
      confidence_bucket TEXT NOT NULL,
      is_overconfident INTEGER NOT NULL,
      is_underconfident INTEGER NOT NULL,
      calibration_error REAL NOT NULL,
      brier_score REAL NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pforensics_reason ON prediction_forensics(primary_failure_reason);
    CREATE INDEX IF NOT EXISTS idx_pforensics_bucket ON prediction_forensics(confidence_bucket);

    -- 36. Daily Aggregated Prediction Metrics (Phase 5 & 16)
    CREATE TABLE IF NOT EXISTS prediction_daily_metrics (
      date TEXT PRIMARY KEY,
      total_predictions INTEGER NOT NULL,
      completed_predictions INTEGER NOT NULL,
      pending_predictions INTEGER NOT NULL,
      actionable_predictions INTEGER NOT NULL,
      abstained_predictions INTEGER NOT NULL,
      correct_predictions INTEGER NOT NULL,
      incorrect_predictions INTEGER NOT NULL,
      accuracy_pct REAL NOT NULL,
      tp_first_count INTEGER NOT NULL,
      sl_first_count INTEGER NOT NULL,
      time_exit_count INTEGER NOT NULL,
      no_entry_count INTEGER NOT NULL,
      avg_confidence REAL NOT NULL,
      avg_expected_r REAL NOT NULL,
      avg_realized_r REAL NOT NULL,
      realized_profit_factor REAL NOT NULL,
      brier_score REAL NOT NULL,
      calibration_error REAL NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- 29. Risk Configs & System Settings
    CREATE TABLE IF NOT EXISTS risk_configs (
      id TEXT PRIMARY KEY,
      max_risk_per_trade_pct REAL NOT NULL,
      max_daily_loss_pct REAL NOT NULL,
      max_open_positions INTEGER NOT NULL,
      trading_mode TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;

  db.run(schemaSQL);

  // Safe migrations for preexisting DB
  const safeAddColumns = [
    'ALTER TABLE signals ADD COLUMN pair TEXT;',
    'ALTER TABLE signals ADD COLUMN timeframe TEXT;',
    'ALTER TABLE signals ADD COLUMN entry_min REAL;',
    'ALTER TABLE signals ADD COLUMN entry_max REAL;',
    'ALTER TABLE signals ADD COLUMN target3 REAL;',
    'ALTER TABLE signals ADD COLUMN trend TEXT;',
    'ALTER TABLE signals ADD COLUMN market_regime TEXT;',
    'ALTER TABLE signals ADD COLUMN session TEXT;',
    'ALTER TABLE signals ADD COLUMN data_status TEXT;',
    'ALTER TABLE signals ADD COLUMN strategy_version TEXT;'
  ];
  try {
    db.run('ALTER TABLE execution_intents ADD COLUMN claim_token TEXT;');
  } catch {
    // Column already exists.
  }
  db.run("UPDATE execution_intents SET claim_token = idempotency_key WHERE claim_token IS NULL OR claim_token = ''");

  for (const alter of safeAddColumns) {
    try {
      db.run(alter);
    } catch {
      // Column already exists, ignore
    }
  }

  // Safe migration for signals.ml_probability NOT NULL constraint in preexisting DB
  try {
    const tableInfo = db.exec("PRAGMA table_info(signals)");
    const mlCol = tableInfo[0]?.values?.find((col: any[]) => col[1] === 'ml_probability');
    if (mlCol && mlCol[3] === 1) {
      db.run("CREATE TABLE IF NOT EXISTS signals_temp (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, market TEXT NOT NULL, instrument TEXT NOT NULL, pair TEXT, timeframe TEXT, underlying TEXT, direction TEXT NOT NULL, category TEXT NOT NULL, strategy TEXT NOT NULL, score REAL NOT NULL, ml_probability REAL, entry_preferred REAL NOT NULL, entry_min REAL, entry_max REAL, stop_loss REAL NOT NULL, target1 REAL NOT NULL, target2 REAL NOT NULL, target3 REAL, risk_reward REAL NOT NULL, trend TEXT, market_regime TEXT, session TEXT, status TEXT NOT NULL, data_status TEXT, strategy_version TEXT, model_version TEXT NOT NULL)");
      db.run("INSERT INTO signals_temp (id, timestamp, market, instrument, pair, timeframe, underlying, direction, category, strategy, score, ml_probability, entry_preferred, entry_min, entry_max, stop_loss, target1, target2, target3, risk_reward, trend, market_regime, session, status, data_status, strategy_version, model_version) SELECT id, timestamp, market, instrument, pair, timeframe, underlying, direction, category, strategy, score, ml_probability, entry_preferred, entry_min, entry_max, stop_loss, target1, target2, target3, risk_reward, trend, market_regime, session, status, data_status, strategy_version, model_version FROM signals");
      db.run("DROP TABLE signals");
      db.run("ALTER TABLE signals_temp RENAME TO signals");
    }
  } catch (err) {
    console.warn('Migration for signals table nullability skipped:', err);
  }
}

function seedInitialData(db: Database) {
  // Markets
  db.run(`INSERT OR IGNORE INTO markets (id, code, name, status, currency) VALUES 
    ('mkt_fx', 'FOREX', 'Global Foreign Exchange', 'ACTIVE', 'USD'),
    ('mkt_in_eq', 'INDIA_EQUITY', 'Indian Equity Benchmark Indices', 'ACTIVE', 'INR'),
    ('mkt_in_opt', 'INDIA_OPTIONS', 'Indian Equity Index Options', 'ACTIVE', 'INR');
  `);

  // System settings
  const now = Date.now();
  db.run(`INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES 
    ('TRADING_MODE', 'LIVE_ONLY', ${now}),
    ('DATA_STATUS', 'UNAVAILABLE', ${now}),
    ('MODEL_STATUS', 'BASELINE_UNCALIBRATED', ${now}),
    ('DEFAULT_RISK_PCT', '1.0', ${now}),
    ('STRIKE_DEPTH', '7', ${now}),
    ('MAX_TRADE_VALUE_FOREX_USD', '100000', ${now}),
    ('MAX_TRADE_VALUE_INDIAN_INR', '1000000', ${now});
  `);

  // Enforce LIVE_ONLY persistence.
  db.run(`UPDATE system_settings SET value = 'LIVE_ONLY', updated_at = ${now} WHERE key = 'TRADING_MODE';
    UPDATE system_settings SET value = 'UNAVAILABLE', updated_at = ${now} WHERE key = 'DATA_STATUS';
    UPDATE risk_configs SET trading_mode = 'LIVE_ONLY';
  `);

  // Risk configs
  db.run(`INSERT OR IGNORE INTO risk_configs (id, max_risk_per_trade_pct, max_daily_loss_pct, max_open_positions, trading_mode) VALUES 
    ('default_risk', 1.0, 3.0, 5, 'LIVE_ONLY');
  `);

  // Economic events
  db.run(`INSERT OR IGNORE INTO economic_events (id, title, currency, impact, timestamp, blocks_entry) VALUES 
    ('ev_1', 'FOMC Rate Decision & Press Conference', 'USD', 'HIGH', ${now + 7200000}, 0),
    ('ev_2', 'ECB Monetary Policy Statement', 'EUR', 'HIGH', ${now + 14400000}, 0),
    ('ev_3', 'RBI Monetary Policy Committee Outcome', 'INR', 'HIGH', ${now + 28800000}, 0),
    ('ev_4', 'US Core CPI Inflation (YoY)', 'USD', 'HIGH', ${now + 50000000}, 0);
  `);
}

export async function executeQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const db = await getDatabase();
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

export async function executeRun(sql: string, params: any[] = []): Promise<void> {
  const db = await getDatabase();
  db.run(sql, params);
  persistDatabase();
}
export async function executeTransaction<T>(work: (db: Database) => T): Promise<T> {
  const db = await getDatabase();
  db.run('BEGIN IMMEDIATE TRANSACTION');
  try {
    const result = work(db);
    db.run('COMMIT');
    persistDatabase();
    return result;
  } catch (err) {
    try {
      db.run('ROLLBACK');
    } catch {
      // Preserve the original transaction error.
    }
    throw err;
  }
}


export async function getDatabaseStats() {
  const db = await getDatabase();
  const tables = [
    'markets', 'currency_pairs', 'underlyings', 'contracts', 'candles',
    'signals', 'trades', 'positions', 'orders', 'economic_events',
    'risk_configs', 'system_settings', 'broker_accounts',
    'broker_reconciliation_snapshots', 'execution_intents', 'execution_fill_observations', 'execution_fill_events',
    'trade_traces', 'trade_trace_nodes', 'trade_notes', 'ml_storage_records'
  ];

  const stats: Record<string, number> = {};
  for (const table of tables) {
    try {
      const res = db.exec(`SELECT count(*) as count FROM ${table}`);
      const count = (res[0]?.values[0]?.[0] as number) ?? 0;
      stats[table] = count;
    } catch {
      stats[table] = 0;
    }
  }

  return stats;
}
