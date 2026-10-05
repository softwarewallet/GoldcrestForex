# GOLDCREST FOREX — PHASE 43 SINGLE-POSITION DYNAMIC MARTINGALE REPORT

**Feature:** Single-Position Dynamic Martingale / Recovery Strategy (`MartingaleRecoveryService`)  
**Date:** October 5, 2026  
**Status:** IMPLEMENTED — USER CONTROLLED — OFF BY DEFAULT  

---

## 1. Files Changed & Added

1. **`src/services/configService.ts`**:
   - Added `MartingaleConfig` interface and default configuration object (`enabled: false`, `scope: 'ALL'`, `adverseTriggerPips: 5.0`, `volumeMultiplier: 2.0`, `maxRecoveryLevels: 5`, `maximumVolume: 50.0`, etc.).
   - Added `'martingale'` to persisted configuration keys.

2. **`src/services/martingaleRecoveryService.ts`**:
   - Implemented core single-position Martingale state machine (`IDLE`, `ACTIVE`, `TRIGGER_DETECTED`, `MODIFICATION_PENDING`, `VOLUME_MODIFIED`, `TP_RECALCULATION_PENDING`, `TP_MODIFIED`, `WAITING_NEXT_TRIGGER`, `CLOSING`, `COMPLETED`, `ABORTED`).
   - Handles single position anchor tracking, adverse price movement triggers (default $5\text{ pips}$), weighted entry price recalculation, Dynamic TP modification, and sequence completion/reset.

3. **`src/database/db.ts`**:
   - Created SQLite database schema for `martingale_sequences` table with indexes on `position_id`, `pair`, and `status`.

4. **`src/components/MartingaleSettingsPanel.tsx` & `SettingsHub.tsx`**:
   - Created dedicated UI settings panel under "Settings -> MARTINGALE / RECOVERY STRATEGY" with Enable toggle, All vs Selected Pairs selector, pair checklists, numeric trigger inputs, and safety limit controls.

5. **`test/test_phase43_martingale_strategy.ts`**:
   - Created test suite verifying default OFF state, persistence, pair scope eligibility, single-position volume doubling, Dynamic TP recalculation, idempotency tick protection, safety limit gates, and sequence completion.

---

## 2. Database Schema (`martingale_sequences`)

```sql
CREATE TABLE IF NOT EXISTS martingale_sequences (
  id TEXT PRIMARY KEY,
  sequence_id TEXT UNIQUE NOT NULL,
  position_id TEXT NOT NULL,
  pair TEXT NOT NULL,
  direction TEXT NOT NULL,
  base_volume REAL NOT NULL,
  current_volume REAL NOT NULL,
  recovery_level INTEGER NOT NULL,
  last_trigger_price REAL NOT NULL,
  next_trigger_price REAL NOT NULL,
  current_tp REAL NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_recovery_at INTEGER,
  completed_at INTEGER,
  initial_prediction_score REAL,
  current_prediction_score REAL,
  initial_entry_price REAL NOT NULL,
  current_average_entry REAL NOT NULL,
  floating_pnl REAL,
  max_floating_loss REAL,
  max_margin_used REAL,
  final_realized_pnl REAL,
  completion_reason TEXT
);
```

---

## 3. State Machine & Execution Logic

1. **Initial Position Anchor:** Maintains **ONE logical cTrader position** per sequence.
2. **Adverse Trigger Calculation:**
   - For BUY: trigger at `lastRecoveryTriggerPrice - (5.0 pips)`.
   - For SELL: trigger at `lastRecoveryTriggerPrice + (5.0 pips)`.
3. **Single Position Amendment:** Does NOT open a separate trade. Modifies existing position volume ($2.0\times$) and updates Dynamic TP based on new weighted average entry price.
4. **Idempotency Guard:** `MODIFICATION_PENDING` lock prevents duplicate volume modifications from concurrent ticks.

---

## 4. Safety & Protection Confirmations

- **Defaults OFF:** `martingale.enabled = false` after installation or upgrades.
- **Stop Loss Policy:** No individual SL on Martingale managed position (`stopLoss = NONE`), but Live Safety Gate, maximum position volume, max recovery levels, max duration, and max basket drawdown protections remain strictly enforced.
- **Scope Behavior:** `ALL` pairs vs `SELECTED` pairs filter evaluated prior to initial position registration. Disabling Martingale or unselecting a pair during an active sequence allows the active sequence to finish under its established TP policy without forcibly closing or executing further volume increases.
- **cTrader Live/Demo Routing:** Unchanged.
- **Normal Trading Execution:** Unchanged when Martingale is OFF.

---

## 5. Status & Verdict

**STATUS:** **IMPLEMENTED — USER CONTROLLED — OFF BY DEFAULT**
