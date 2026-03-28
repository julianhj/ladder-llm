import { StructuredCV, StructuredJobDescription } from '../schemas/StructuredInputs.js';
import { createHash } from 'crypto';

interface CachedData {
  structured_cv: StructuredCV;
  structured_job_description: StructuredJobDescription;
  timestamp: number;
}

/**
 * Simple in-memory cache for preprocessed CV and job description data.
 * Key: hash of (unstructured CV text + unstructured job description text + prompt versions).
 * Value: structured CV and structured job description with timestamp.
 */
class PreprocessingCache {
  private cache: Map<string, CachedData> = new Map();
  private maxSize: number = 100; // Maximum number of cached entries
  private ttl: number = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  /**
   * Generate hash key from unstructured CV and unstructured job description text, including prompt versions.
   */
  private generateKey(cvText: string, jobDescriptionText: string, cvPromptVersion: string, jobDescriptionPromptVersion: string): string {
    const combined = `${cvText}\n---\n${jobDescriptionText}\n---\n${cvPromptVersion}\n---\n${jobDescriptionPromptVersion}`;
    return createHash('sha256').update(combined).digest('hex');
  }

  /**
   * Exposes deterministic cache key for diagnostics without logging unstructured CV text.
   */
  getDebugKey(cvText: string, jobDescriptionText: string, cvPromptVersion: string, jobDescriptionPromptVersion: string): string {
    return this.generateKey(cvText, jobDescriptionText, cvPromptVersion, jobDescriptionPromptVersion);
  }

  /**
   * Check if data is cached and still valid
   */
  get(cvText: string, jobDescriptionText: string, cvPromptVersion: string, jobDescriptionPromptVersion: string): { structured_cv: StructuredCV; structured_job_description: StructuredJobDescription } | null {
    const key = this.generateKey(cvText, jobDescriptionText, cvPromptVersion, jobDescriptionPromptVersion);
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // Check if cache entry has expired
    const now = Date.now();
    if (now - cached.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return {
      structured_cv: cached.structured_cv,
      structured_job_description: cached.structured_job_description,
    };
  }

  /**
   * Store preprocessed data in cache
   */
  set(
    cvText: string,
    jobDescriptionText: string,
    structured_cv: StructuredCV,
    structured_job_description: StructuredJobDescription,
    cvPromptVersion: string,
    jobDescriptionPromptVersion: string
  ): void {
    const key = this.generateKey(cvText, jobDescriptionText, cvPromptVersion, jobDescriptionPromptVersion);

    // Evict oldest entries if cache is full
    if (this.cache.size >= this.maxSize) {
      const oldestKey = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      structured_cv,
      structured_job_description,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; ttl: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl,
    };
  }
}

// Singleton instance
export const preprocessingCache = new PreprocessingCache();
