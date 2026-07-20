import type { ZoneSchema } from '../zones/schema.js';

/**
 * Sales playbook: a dedicated rep-facing pre-call structure, not the meeting
 * brief. Five fixed sections ported from the production reference deployment's
 * playbook doctrine. The shared zone generator produces the section text (each
 * section is a zone); this module owns the section set, the property mapping,
 * and the composed rep-facing document.
 */
export interface PlaybookSectionSpec {
  name: string;
  label: string;
  max_chars: number;
  fallback: string;
  guidance: string;
}

export const PLAYBOOK_SECTIONS: readonly PlaybookSectionSpec[] = [
  {
    name: 'account_snapshot',
    label: 'Account snapshot',
    max_chars: 400,
    fallback: 'Review the account record before the call: industry, size, and recent activity.',
    guidance: 'Three concrete facts about the company from research and CRM fields. No invention.'
  },
  {
    name: 'why_now',
    label: 'Why now',
    max_chars: 300,
    fallback: 'No timely trigger on file; open on a relevant business priority.',
    guidance: 'One or two dated signals within the recency window that make this a good moment. Never undated or future-dated.'
  },
  {
    name: 'talk_track',
    label: 'Talk track',
    max_chars: 500,
    fallback: 'Lead with the account facts above and ask an open question about their current priorities.',
    guidance: 'Three openers tied to the account facts. Offer framing, never assume product ownership.'
  },
  {
    name: 'landmines',
    label: 'Landmines',
    max_chars: 300,
    fallback: 'Do not assume the account already uses the product; confirm before claiming it.',
    guidance: 'What not to say, including any unconfirmed ownership claim.'
  },
  {
    name: 'next_step',
    label: 'Next step',
    max_chars: 200,
    fallback: 'Propose a short follow-up working session.',
    guidance: 'One concrete, low-friction next action.'
  }
];

export function playbookSectionSchema(): ZoneSchema {
  return {
    format_version: 1,
    output: 'plain_text',
    zones: PLAYBOOK_SECTIONS.map((s) => ({
      name: s.name,
      max_chars: s.max_chars,
      fallback: s.fallback,
      guidance: s.guidance
    }))
  };
}

export function assemblePlaybook(sectionTexts: Record<string, string>): {
  full: string;
  properties: Record<string, string>;
} {
  const properties: Record<string, string> = {};
  const blocks: string[] = [];
  for (const s of PLAYBOOK_SECTIONS) {
    const text = sectionTexts[s.name]?.trim() ? sectionTexts[s.name]!.trim() : s.fallback;
    properties[`playbook_${s.name}`] = text;
    blocks.push(`${s.label}\n${text}`);
  }
  return { full: blocks.join('\n\n'), properties };
}
