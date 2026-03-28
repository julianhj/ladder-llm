import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import type { AuditLog, WrappedAuditLog } from '../logic/stage_10_audit_logging/auditLog.js';
import { Logger } from './Logger.js';
import { getExecutionTimeTrackerDir } from './executionTimeTrackerDir.js';

const _dir = getExecutionTimeTrackerDir();

export interface OpenAITiming {
  agentId?: string;
  agentName: string;
  stageId?: string;
  stageName?: string;
  type: 'agent' | 'preprocessing_cv' | 'preprocessing_job_description';
  model: string;
  startTime: string; // ISO timestamp
  endTime: string; // ISO timestamp
  executionTimeMs: number;
  attempt?: number; // For retries
  success: boolean;
  error?: string;
}

export interface StageTiming {
  stageId?: string;
  stageName: string;
  startTime: string;
  endTime: string;
  executionTimeMs: number;
}

export interface ExecutionTimeLog {
  runId: string;
  totalBackendProcessingTimeMs: number;
  backendStartTime: string;
  backendEndTime: string;
  preprocessing?: {
    cv?: {
      startTime: string;
      endTime: string;
      executionTimeMs: number;
      cached?: boolean;
    };
    jobDescription?: {
      startTime: string;
      endTime: string;
      executionTimeMs: number;
      cached?: boolean;
    };
  };
  openaiRequests: OpenAITiming[];
  stages: StageTiming[];
  /** Legacy logs may be flat AuditLog; new logs use WrappedAuditLog (ui + machine). */
  audit?: AuditLog | WrappedAuditLog;
}

/**
 * ExecutionTimeTracker - Tracks execution times for a single assessment run.
 * Create one per request (e.g. in main()) and pass it through the pipeline for concurrent-safety.
 */
export class ExecutionTimeTracker {
  private runId: string | null = null;
  private backendStartTime: number | null = null;
  private backendEndTime: number | null = null;
  private openaiRequests: OpenAITiming[] = [];
  private stages: StageTiming[] = [];
  private preprocessing: ExecutionTimeLog['preprocessing'] = {};

  constructor() {
    // Per-request instance; no singleton.
  }

  /**
   * Create a new tracker instance. Use when no request-scoped tracker is provided (e.g. tests).
   * Prefer passing a tracker from RequestScopedContext for concurrent runs.
   */
  static getInstance(): ExecutionTimeTracker {
    return new ExecutionTimeTracker();
  }

  /**
   * Initialize tracker with runId
   */
  initialize(runId: string, backendStartTime: number): void {
    this.runId = runId;
    this.backendStartTime = backendStartTime;
    this.openaiRequests = [];
    this.stages = [];
    this.preprocessing = {};
  }

  /**
   * Record backend end time
   */
  recordBackendEnd(backendEndTime: number): void {
    this.backendEndTime = backendEndTime;
  }

  /**
   * Record an OpenAI API request timing
   */
  recordOpenAIRequest(
    agentName: string,
    type: 'agent' | 'preprocessing_cv' | 'preprocessing_job_description',
    model: string,
    startTime: number,
    endTime: number,
    success: boolean,
    stageName?: string,
    attempt?: number,
    error?: string,
    agentId?: string,
    stageId?: string
  ): void {
    const timing: OpenAITiming = {
      agentName,
      type,
      model,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      executionTimeMs: endTime - startTime,
      success,
    };

    if (agentId) {
      timing.agentId = agentId;
    }
    if (stageId) {
      timing.stageId = stageId;
    }
    if (stageName) {
      timing.stageName = stageName;
    }

    if (attempt !== undefined) {
      timing.attempt = attempt;
    }

    if (error) {
      timing.error = error;
    }

    // Thread-safe: push to array (JS is single-threaded, but this ensures order)
    this.openaiRequests.push(timing);
  }

  /**
   * Record preprocessing timing
   */
  recordPreprocessing(
    type: 'cv' | 'jobDescription',
    startTime: number,
    endTime: number,
    cached: boolean = false
  ): void {
    const timing = {
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      executionTimeMs: endTime - startTime,
      cached,
    };

    // Ensure preprocessing object exists
    if (!this.preprocessing) {
      this.preprocessing = {};
    }

    if (type === 'cv') {
      this.preprocessing.cv = timing;
    } else {
      this.preprocessing.jobDescription = timing;
    }
  }

  /**
   * Record stage timing
   */
  recordStage(stageName: string, startTime: number, endTime: number, stageId?: string): void {
    const timing: StageTiming = {
      stageName,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      executionTimeMs: endTime - startTime,
    };
    if (stageId) {
      timing.stageId = stageId;
    }
    this.stages.push(timing);
  }

  /**
   * Write execution time log to file. Pass audit log from pipeline (full on success, minimal + pipeline_error on failure).
   * Accepts flat AuditLog (legacy/error path) or WrappedAuditLog (new enterprise audit).
   */
  async writeLogFile(auditLog?: AuditLog | WrappedAuditLog): Promise<string> {
    if (!this.runId || !this.backendStartTime || !this.backendEndTime) {
      throw new Error('ExecutionTimeTracker not properly initialized or backend timing not recorded');
    }

    try {
      // Extract date and time from runId (format: YYYY-MM-DDTHH-MM-SS)
      let dateStr: string;
      let timeStr: string;
      if (this.runId.includes('T')) {
        const parts = this.runId.split('T');
        dateStr = parts[0]; // YYYY-MM-DD
        timeStr = parts[1]; // HH-MM-SS (already has colons replaced)
      } else {
        // Fallback: use current date
        const now = new Date();
        dateStr = now.toISOString().split('T')[0];
        timeStr = this.runId;
      }

      // Create folder structure: logs/YYYY-MM-DD/HH-MM-SS/
      const logsBaseDir = path.resolve(_dir, '../../../logs');
      const dateDir = path.join(logsBaseDir, dateStr);
      const timeDir = path.join(dateDir, timeStr);

      // Create directories recursively
      try {
        await mkdir(timeDir, { recursive: true });
      } catch (mkdirError) {
        // Directory might already exist - that's fine
        if ((mkdirError as any).code !== 'EEXIST') {
          throw mkdirError;
        }
      }

      const stagesForLog = this.stages;

      // Create log object
      const log: ExecutionTimeLog = {
        runId: this.runId!,
        totalBackendProcessingTimeMs: this.backendEndTime! - this.backendStartTime!,
        backendStartTime: new Date(this.backendStartTime!).toISOString(),
        backendEndTime: new Date(this.backendEndTime!).toISOString(),
        preprocessing: (this.preprocessing && (this.preprocessing.cv || this.preprocessing.jobDescription)) ? this.preprocessing : undefined,
        openaiRequests: this.openaiRequests,
        stages: stagesForLog,
        ...(auditLog != null && { audit: auditLog }),
      };

      // Write file
      const filePath = path.join(timeDir, 'execution_times.json');
      await writeFile(filePath, JSON.stringify(log, null, 2), 'utf-8');

      Logger.debug('ExecutionTimeTracker', 'Execution time log written', {
        filePath,
        requestCount: this.openaiRequests.length,
        stageCount: this.stages.length,
        totalTimeMs: log.totalBackendProcessingTimeMs,
      });

      return filePath;
    } catch (error) {
      Logger.warn('ExecutionTimeTracker', 'Failed to write execution time log file', {
        error: (error as Error).message,
        runId: this.runId,
      });
      throw error;
    }
  }

  /**
   * Get current log data (for testing/debugging)
   */
  getLogData(): Partial<ExecutionTimeLog> {
    return {
      runId: this.runId || undefined,
      totalBackendProcessingTimeMs: this.backendStartTime && this.backendEndTime
        ? this.backendEndTime - this.backendStartTime
        : undefined,
      backendStartTime: this.backendStartTime ? new Date(this.backendStartTime).toISOString() : undefined,
      backendEndTime: this.backendEndTime ? new Date(this.backendEndTime).toISOString() : undefined,
      preprocessing: (this.preprocessing && (this.preprocessing.cv || this.preprocessing.jobDescription)) ? this.preprocessing : undefined,
      openaiRequests: this.openaiRequests,
      stages: this.stages,
    };
  }

  /**
   * Reset tracker (for testing)
   */
  reset(): void {
    this.runId = null;
    this.backendStartTime = null;
    this.backendEndTime = null;
    this.openaiRequests = [];
    this.stages = [];
    this.preprocessing = {};
  }
}
