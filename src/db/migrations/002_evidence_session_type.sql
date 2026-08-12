-- 002_evidence_session_type — adds 'session' to evidence.type.
--
-- 'session' is weaker than 'produced' (git-commit-verified by attribution)
-- but stronger than a bare 'claimed' self-report: it means a tutor session
-- fired for this concept and the user didn't override it. Written by the
-- Stop hook (src/capture/stop-hook.ts), never verified against a real
-- commit — see docs/schema.md for the full tier writeup.
ALTER TABLE evidence DROP CONSTRAINT evidence_type_check;
ALTER TABLE evidence ADD CONSTRAINT evidence_type_check
  CHECK (type IN ('produced', 'claimed', 'session'));
