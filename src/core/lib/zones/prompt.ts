import type { ZoneSpec } from './schema.js';

export interface LeadContext {
  company: string;
  industry?: string;
  title?: string;
  researched_facts?: string[];
  confirmed_customer?: boolean;
}

/**
 * Pure, deterministic prompt assembly. Guidelines are included sorted by
 * name; lead facts verbatim; hard constraints last so they are closest to
 * the generation. Ownership and banned-phrase ENFORCEMENT happens at the
 * engine guards choke point when this core is wired (WS4-B); the prompt
 * instructs, the guards enforce.
 */
export function buildZonePrompt(zone: ZoneSpec, guidelines: Record<string, string>, lead: LeadContext): string {
  const parts: string[] = [];
  parts.push('You write one personalization zone for a business web surface.');
  const names = Object.keys(guidelines).sort();
  for (const name of names) {
    parts.push(`## Guideline: ${name}\n${guidelines[name]}`);
  }
  parts.push(`## Lead context\nCompany: ${lead.company}`);
  if (lead.industry) parts.push(`Industry: ${lead.industry}`);
  if (lead.title) parts.push(`Recipient role: ${lead.title}`);
  const facts = lead.researched_facts ?? [];
  if (facts.length > 0) {
    parts.push(`Researched facts (use at most one, verbatim meaning, do not invent others):\n${facts.map((f) => `- ${f}`).join('\n')}`);
  } else {
    parts.push('No researched facts are available. Write from the guidelines and company name only; do not invent specifics.');
  }
  if (lead.confirmed_customer !== true) {
    parts.push('The company is NOT a confirmed customer: never state or imply the company already uses the product. Offer framing only.');
  }
  parts.push(`## Zone: ${zone.name}\n${zone.guidance}${zone.theme ? `\nTheme: ${zone.theme}` : ''}`);
  parts.push(
    `## Hard constraints\nWrite plain text only, one paragraph, no markdown, no lists, no quotes around the output, at most ${zone.max_chars} characters, do not invent facts, no em dashes.`
  );
  return parts.join('\n\n');
}
