import { readFile } from 'fs/promises';
import { buildAuditLog, type AuditLog } from '../src/recruitment/logic/stage_10_audit_logging/auditLog';
import { ExecutionTimeTracker } from '../src/recruitment/utils/ExecutionTimeTracker';

describe('ExecutionTimeTracker', () => {
  describe('writeLogFile', () => {
    it('writes execution_times.json without audit when writeLogFile() is called with no argument', async () => {
      const tracker = new ExecutionTimeTracker();
      const runId = '2026-03-02T16-00-00';
      const start = Date.now() - 500;
      tracker.initialize(runId, start);
      tracker.recordBackendEnd(Date.now());

      const filePath = await tracker.writeLogFile();
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.runId).toBe(runId);
      expect(parsed.audit).toBeUndefined();
    });

    it('writes execution_times.json with audit key when writeLogFile(auditLog) is called', async () => {
      const tracker = new ExecutionTimeTracker();
      const runId = '2026-03-02T16-00-01';
      const start = Date.now() - 500;
      tracker.initialize(runId, start);
      tracker.recordBackendEnd(Date.now());

      const auditLog: AuditLog = {
        audit_timestamp: '2026-03-02T14:00:00.000Z',
        candidate_id: 'test@example.com',
        final_decision: 'hire',
        consensus_score: 85,
        pipeline_error: undefined,
      };

      const filePath = await tracker.writeLogFile(auditLog);
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.runId).toBe(runId);
      expect(parsed.audit).toBeDefined();
      expect(parsed.audit.audit_timestamp).toBe('2026-03-02T14:00:00.000Z');
      expect(parsed.audit.candidate_id).toBe('test@example.com');
      expect(parsed.audit.final_decision).toBe('hire');
      expect(parsed.audit.consensus_score).toBe(85);
      expect(parsed.audit.pipeline_error).toBeUndefined();
    });

    it('writes pipeline_error in audit when provided (e.g. failed run)', async () => {
      const tracker = new ExecutionTimeTracker();
      const runId = '2026-03-02T16-00-02';
      const start = Date.now() - 500;
      tracker.initialize(runId, start);
      tracker.recordBackendEnd(Date.now());

      const auditLog: AuditLog = {
        audit_timestamp: '2026-03-02T14:00:00.000Z',
        candidate_id: 'fail@example.com',
        pipeline_error: 'Pipeline threw: Connection timeout',
      };

      const filePath = await tracker.writeLogFile(auditLog);
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.audit).toBeDefined();
      expect(parsed.audit.pipeline_error).toBe('Pipeline threw: Connection timeout');
      expect(parsed.audit.candidate_id).toBe('fail@example.com');
    });

    it('accepts WrappedAuditLog and preserves root-level final_decision and consensus_score', async () => {
      const stages: import('../src/recruitment/logic/stage_10_audit_logging/auditLog').AuditLogStageResult[] = [
        {
          stageId: 'stage_14_consensus_decision',
          stageName: 'Stage 14 - Consensus Decision',
          results: [{ success: true, agentId: 'consensus_decision_maker', agentName: 'Consensus', result: { final_decision: 'hire', confidence: 85 } }],
        },
      ];
      const wrappedAudit = buildAuditLog(stages, undefined, {
        inputPayload: {},
      });

      const tracker = new ExecutionTimeTracker();
      const runId = '2026-03-02T16-00-03';
      const start = Date.now() - 500;
      tracker.initialize(runId, start);
      tracker.recordBackendEnd(Date.now());

      const filePath = await tracker.writeLogFile(wrappedAudit);
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.audit).toBeDefined();
      expect(parsed.audit.final_decision).toBe('hire');
      expect(parsed.audit.consensus_score).toBe(85);
      expect(parsed.audit.ui).toBeDefined();
      expect(parsed.audit.machine).toBeDefined();
    });
  });
});
