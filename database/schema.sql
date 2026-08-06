CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE cycle_status AS ENUM ('ACTIVE', 'COMPLETED', 'RESET');
CREATE TYPE bet_result AS ENUM ('GREEN', 'RED');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bankrolls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  balance NUMERIC(14,2) NOT NULL CHECK (balance >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bankrolls_one_active_per_user ON bankrolls(user_id) WHERE active;

CREATE TABLE green15k_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  target_amount NUMERIC(14,2) NOT NULL CHECK (target_amount > 0),
  current_amount NUMERIC(14,2) NOT NULL CHECK (current_amount >= 0),
  status cycle_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX green15k_one_active_cycle_per_user ON green15k_cycles(user_id) WHERE status = 'ACTIVE';

CREATE TABLE green15k_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES green15k_cycles(id),
  match_id TEXT NOT NULL,
  market TEXT NOT NULL,
  odd NUMERIC(8,3) NOT NULL CHECK (odd > 1),
  stake NUMERIC(14,2) NOT NULL CHECK (stake > 0),
  result bet_result,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
