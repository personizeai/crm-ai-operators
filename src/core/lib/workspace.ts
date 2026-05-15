import { client } from "../config.js";
import { logger } from "./logger.js";

export type UpdateType =
  | "observation"
  | "action"
  | "change"
  | "milestone"
  | "enrichment"
  | "signal"
  | "outreach"
  | "engagement"
  | "system"
  | "score"
  | "qualification"
  | "handoff";

export type NoteCategory =
  | "observation"
  | "analysis"
  | "idea"
  | "reference"
  | "question"
  | "enrichment"
  | "signal"
  | "reply-analysis";

export type Confidence = "low" | "medium" | "high";

export interface WorkspaceUpdate {
  author: string;
  type: UpdateType;
  summary: string;
  details?: Record<string, unknown>;
  timestamp?: string;
}

export interface WorkspaceNote {
  author: string;
  content: string;
  category: NoteCategory;
  timestamp?: string;
}

export interface WorkspaceDecision {
  question: string;
  decision: string;
  reasoning: string;
  alternatives?: string[];
  confidence: Confidence;
  autonomous: boolean;
  approvedBy?: string;
  timestamp?: string;
}

export type EntityIdentifier =
  | { email: string }
  | { website_url: string }
  | { name: string }
  | { record_id: string };

function withTimestamp<T extends { timestamp?: string }>(value: T): T & { timestamp: string } {
  return { ...value, timestamp: value.timestamp ?? new Date().toISOString() } as T & { timestamp: string };
}

async function pushArray(
  entity: EntityIdentifier,
  property: "updates" | "notes" | "decisions" | "messages_sent",
  value: unknown,
  type?: string,
): Promise<void> {
  try {
    const memory = (client as any).memory;
    if (!memory || typeof memory.updateProperty !== "function") {
      logger.warn("Personize SDK has no memory.updateProperty; workspace push skipped", {
        property,
      });
      return;
    }
    await memory.updateProperty({
      ...entity,
      ...(type ? { type } : {}),
      propertyName: property,
      operation: "push",
      value,
    });
  } catch (error) {
    logger.warn("Failed to append workspace property", {
      property,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const workspace = {
  /**
   * Append an event to the entity's chronological timeline. Use for actions taken,
   * observations recorded, milestones reached. Append-only.
   */
  async appendUpdate(entity: EntityIdentifier, update: WorkspaceUpdate, type?: string): Promise<void> {
    return pushArray(entity, "updates", withTimestamp(update), type);
  },

  /**
   * Append a knowledge entry — observation, analysis, idea, reference, question.
   * Append-only.
   */
  async appendNote(entity: EntityIdentifier, note: WorkspaceNote, type?: string): Promise<void> {
    return pushArray(entity, "notes", withTimestamp(note), type);
  },

  /**
   * Append a decision with full reasoning — the explainability layer.
   * Append-only. To reverse a decision, append a new one explaining why.
   */
  async appendDecision(
    entity: EntityIdentifier,
    decision: WorkspaceDecision,
    type?: string,
  ): Promise<void> {
    return pushArray(entity, "decisions", withTimestamp(decision), type);
  },
};
