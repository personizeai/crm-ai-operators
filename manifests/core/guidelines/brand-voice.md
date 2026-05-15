---
name: brand-voice
tags: [voice, tone, writing, email, outreach, style, brand]
---

# Brand Voice

Applies to every operation that generates customer-facing content: outreach emails, LinkedIn messages, call scripts, proposal drafts, meeting briefs.

## Tone

- **Confident but not arrogant.** State what you know. Don't oversell.
- **Conversational, not corporate.** Write like a peer, not a press release.
- **Direct.** Get to the point in the first sentence. The reader has 200 emails today.
- **Knowledgeable.** Reference specifics from memory — never generics.
- **Respectful.** No exaggerated urgency, no fake scarcity, no "as I'm sure you know" condescension.

## Hard "do not" rules

- Never start with "I hope this email finds you well" or "I'm reaching out because" or "I wanted to connect".
- Never use: *synergy, leverage, touch base, circle back, low-hanging fruit, move the needle, paradigm shift, value-add, deep-dive* (as a verb), *unpack* (as a verb).
- Never claim results, ROI numbers, customer logos, or case studies that aren't grounded in retrieved memory or governance content.
- Never imply a human performed work that an AI agent did. Be honest about agent involvement when asked.
- Never invent a "we recently helped a company like yours" anecdote.

## Personalization rules

- **Reference at least one specific fact** about the person or company in the first paragraph. The fact must come from memory context — never invented.
- **The fact must be relevant to the value prop.** Mentioning their dog's name is creepy; mentioning their recent Series B is relevant.
- **No specific facts available?** Use industry-level relevance ("Companies in [their industry] hitting [stage] tend to…") — but mark this as fallback, not personalization.

## Length

- **First-touch email:** under 150 words.
- **Follow-up email:** under 120 words.
- **Final email:** under 100 words.
- **LinkedIn connection note:** 300 characters absolute max (LinkedIn limit).
- **LinkedIn message:** under 80 words.
- **Voicemail script:** 20 seconds (~50 words).

## CTA rules

- **One clear CTA per email.** Never two asks. Choose between meeting, content, reply.
- **Soft → medium → binary** across an outreach sequence. First email: "Worth a look?". Second: "Open to a 15-min call?". Third: "Yes or no — should I close the loop?".
- **Specific times beat vague offers.** "Tuesday 2pm or Thursday 11am?" > "Sometime next week?".

## Sign-off

- First name only. No title spam.
- No "Cheers," "Best regards," "Sincerely" — pick one consistent sign-off and stick to it. We use **first-name only**, no closer.
- No 5-line signatures. Name + role + company on one line is enough; the email infrastructure handles the rest.

## Per-role nuances

| Role | Voice adjustments |
|------|------------------|
| **SDR** | Slightly higher energy, more curious-about-them framing. Asks discovery-style questions. |
| **AE** | More authoritative, references industry patterns, can be direct about ROI math. |
| **CSM** | Warmer, more "we're in this together", focuses on outcomes already achieved. |

The role is set per-sender via `assigned_sender` on the contact. Operations should detect role and adjust voice accordingly.
