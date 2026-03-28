import { AsyncLocalStorage } from 'async_hooks';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
  error?: Error;
  latency?: number;
}

export interface AgentLogEntry extends LogEntry {
  agentId?: string;
  agentName: string;
  stageId?: string;
  stageName?: string;
  inputSize?: number;
  outputSize?: number;
  tokenUsage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** Request-scoped context merged into every log entry for tracing (correlationToken, sessionToken). */
export interface LoggerRequestContext {
  correlationToken: string;
  sessionToken?: string | null;
}

export class Logger {
  private static logLevel: LogLevel = LogLevel.INFO;
  private static logs: LogEntry[] = [];
  private static maxLogs = 1000; // Keep last 1000 logs in memory
  private static requestContextStorage = new AsyncLocalStorage<LoggerRequestContext>();
  /** Fallback when not running inside runWithRequestContext (e.g. tests). Not concurrent-safe. */
  private static fallbackRequestContext: LoggerRequestContext | null = null;

  /**
   * Run a function with request-scoped context. Context is available to all log calls
   * within the callback and any async work it triggers (concurrent-safe).
   */
  static runWithRequestContext<T>(ctx: LoggerRequestContext, fn: () => T): T {
    return this.requestContextStorage.run(ctx, fn);
  }

  static setRequestContext(ctx: LoggerRequestContext): void {
    this.fallbackRequestContext = ctx;
  }

  static clearRequestContext(): void {
    this.fallbackRequestContext = null;
  }

  private static getRequestContext(): LoggerRequestContext | undefined {
    return this.requestContextStorage.getStore() ?? this.fallbackRequestContext ?? undefined;
  }

  static setLogLevel(level: LogLevel) {
    this.logLevel = level;
  }

  static getLogs(): LogEntry[] {
    return [...this.logs];
  }

  static clearLogs() {
    this.logs = [];
  }

  private static shouldLog(level: LogLevel): boolean {
    return level >= this.logLevel;
  }

  private static sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
    const sanitized = { ...data };
    const sensitiveFields = ['email', 'cv_content', 'candidateCV', 'jobDescription', 'previousStageResults'];
    
    for (const field of sensitiveFields) {
      if (field in sanitized && typeof sanitized[field] === 'string') {
        const value = sanitized[field] as string;
        if (value.length > 100) {
          sanitized[field] = `[${value.length} chars - truncated for privacy]`;
        }
      }
    }
    
    return sanitized;
  }

  private static addLog(entry: LogEntry) {
    if (!this.shouldLog(entry.level)) return;

    // Merge request context from AsyncLocalStorage (concurrent-safe) into entry data
    const ctx = this.getRequestContext();
    const mergedData: Record<string, unknown> = ctx
      ? { ...ctx, ...entry.data }
      : { ...entry.data };

    const entryWithContext: LogEntry = {
      ...entry,
      data: Object.keys(mergedData).length > 0 ? mergedData : undefined,
    };

    // Add to in-memory log
    this.logs.push(entryWithContext);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift(); // Remove oldest log
    }

    // Console output
    const levelStr = LogLevel[entry.level];
    const timestamp = entry.timestamp;
    const component = entry.component;
    const message = entry.message;
    
    const logData: any = {
      timestamp,
      level: levelStr,
      component,
      message,
    };

    if (entryWithContext.data) {
      logData.data = this.sanitizeData(entryWithContext.data as Record<string, unknown>);
    }

    if (entry.latency !== undefined) {
      logData.latency = `${entry.latency.toFixed(2)}ms`;
    }

    if (entry.error) {
      logData.error = {
        message: entry.error.message,
        stack: entry.error.stack,
      };
    }

    // Console: only agent start/complete at INFO (single clear line each); WARN/ERROR always; DEBUG when enabled
    const isAgentStart = component === 'AgentBuilder' && message.startsWith('Agent started:');
    const isAgentComplete = component === 'AgentBuilder' && message.startsWith('Agent completed successfully:');
    const isAgentLifecycle = isAgentStart || isAgentComplete;

    const requestCtx = this.getRequestContext();
    const correlationPart = requestCtx ? `correlation=${requestCtx.correlationToken}` : '';
    const sessionPart = (requestCtx?.sessionToken != null && requestCtx.sessionToken !== '') ? `session=${requestCtx.sessionToken}` : '';

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(`[${timestamp}] [${levelStr}] [${component}] ${message}`, logData);
        break;
      case LogLevel.INFO:
        if (isAgentLifecycle) {
          const agentName = message.replace(/^Agent (started|completed successfully): /, '');
          if (isAgentStart) {
            const startParts = [correlationPart, sessionPart].filter(Boolean);
            console.log(`Agent started: ${agentName}${startParts.length ? ` [${startParts.join(' ')}]` : ''}`);
          } else {
            const sec = entry.latency !== undefined ? (entry.latency / 1000).toFixed(1) : '?';
            const agentEntry = entry as AgentLogEntry;
            const tokenTotal = agentEntry.tokenUsage?.total_tokens ?? (agentEntry.tokenUsage?.prompt_tokens != null && agentEntry.tokenUsage?.completion_tokens != null
              ? agentEntry.tokenUsage.prompt_tokens + agentEntry.tokenUsage.completion_tokens
              : null);
            const tokensPart = tokenTotal != null ? `tokens=${tokenTotal}` : 'tokens=n/a';
            const completeParts = [tokensPart, correlationPart, sessionPart].filter(Boolean);
            console.log(`Agent completed: ${agentName} (${sec}s) [${completeParts.join(' ')}]`);
          }
        }
        break;
      case LogLevel.WARN:
        console.warn(`[${timestamp}] [${levelStr}] [${component}] ${message}`, logData);
        break;
      case LogLevel.ERROR:
        console.error(`[${timestamp}] [${levelStr}] [${component}] ${message}`, logData);
        break;
    }
  }

  static debug(component: string, message: string, data?: Record<string, unknown>) {
    this.addLog({
      timestamp: new Date().toISOString(),
      level: LogLevel.DEBUG,
      component,
      message,
      data,
    });
  }

  static info(component: string, message: string, data?: Record<string, unknown>, latency?: number) {
    this.addLog({
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      component,
      message,
      data,
      latency,
    });
  }

  static warn(component: string, message: string, data?: Record<string, unknown>) {
    this.addLog({
      timestamp: new Date().toISOString(),
      level: LogLevel.WARN,
      component,
      message,
      data,
    });
  }

  static error(component: string, message: string, error?: Error, data?: Record<string, unknown>) {
    this.addLog({
      timestamp: new Date().toISOString(),
      level: LogLevel.ERROR,
      component,
      message,
      error,
      data,
    });
  }

  static logAgentStart(
    agentName: string,
    stageName?: string,
    inputData?: Record<string, unknown>,
    agentId?: string,
    stageId?: string
  ) {
    const entry: AgentLogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      component: 'AgentBuilder',
      message: `Agent started: ${agentName}`,
      agentId,
      agentName,
      stageId,
      stageName,
      inputSize: inputData ? JSON.stringify(inputData).length : undefined,
    };
    this.addLog(entry);
  }

  static logAgentComplete(
    agentName: string,
    latency: number,
    outputSize?: number,
    tokenUsage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
    stageName?: string,
    agentId?: string,
    stageId?: string
  ) {
    const entry: AgentLogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      component: 'AgentBuilder',
      message: `Agent completed successfully: ${agentName}`,
      agentId,
      agentName,
      stageId,
      stageName,
      latency,
      outputSize,
      tokenUsage,
    };
    this.addLog(entry);
  }

  static logAgentError(
    agentName: string,
    error: Error,
    stageName?: string,
    inputData?: Record<string, unknown>,
    agentId?: string,
    stageId?: string
  ) {
    const entry: AgentLogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.ERROR,
      component: 'AgentBuilder',
      message: `Agent completed with error: ${agentName}`,
      agentId,
      agentName,
      stageId,
      stageName,
      error,
      inputSize: inputData ? JSON.stringify(inputData).length : undefined,
      data: inputData, // Include full data for debugging
    };
    this.addLog(entry);
  }

  static logStageStart(stageName: string, agentCount: number, stageId?: string) {
    this.info('PipelineRunner', `Starting stage: ${stageName}`, {
      stageId,
      stageName,
      agentCount,
    });
  }

  static logStageComplete(stageName: string, latency: number, resultCount: number, stageId?: string) {
    this.info('PipelineRunner', `Completed stage: ${stageName}`, {
      stageId,
      stageName,
      resultCount,
    }, latency);
  }

  static logPipelineStart(stageCount: number) {
    this.info('PipelineRunner', 'Starting pipeline execution', {
      stageCount,
    });
  }

  static logPipelineComplete(latency: number, totalStages: number) {
    this.info('PipelineRunner', 'Pipeline execution completed', {
      totalStages,
    }, latency);
  }

  static logPipelineError(error: Error, stageName?: string, stageId?: string) {
    this.error('PipelineRunner', 'Pipeline execution error', error, {
      stageId,
      stageName,
    });
  }

  // Export logs as JSON for external monitoring
  static exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  // Get summary statistics
  static getStats(): {
    totalLogs: number;
    errors: number;
    warnings: number;
    agentExecutions: number;
    averageLatency?: number;
  } {
    const agentLogs = this.logs.filter(log => 'agentName' in log) as AgentLogEntry[];
    // Count unique agent executions by counting only logAgentStart calls
    // This gives us the actual number of agent invocations, not log entries
    const agentStarts = agentLogs.filter(
      log => log.message.includes('Agent started:') || log.message.includes('Starting agent:')
    );
    const latencies = agentLogs
      .filter(log => log.latency !== undefined)
      .map(log => log.latency!);
    
    return {
      totalLogs: this.logs.length,
      errors: this.logs.filter(log => log.level === LogLevel.ERROR).length,
      warnings: this.logs.filter(log => log.level === LogLevel.WARN).length,
      agentExecutions: agentStarts.length, // Count unique agent invocations, not log entries
      averageLatency: latencies.length > 0 
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length 
        : undefined,
    };
  }
}

