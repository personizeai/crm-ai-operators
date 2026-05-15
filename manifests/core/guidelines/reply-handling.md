---
name: reply-handling
tags: [reply, response, inbound, sentiment, escalation, handoff]
---

# Reply Handling

> What to do when a contact replies. The `analyze.reply-sentiment` operation classifies the reply, then this guideline determines the next action.

## Reply classes

Every reply must be classified into exactly one of these:

| Class | Definition | Next action |
|-------|-----------|-------------|
| **Positive interest** | Wants to learn more, asks for a meeting, agrees to a call | Stop sequence + notify rep + draft response in <2h |
| **Question** | Wants info before deciding (pricing, features, ROI, fit) | Stop sequence + AI drafts response, human reviews if score >= 80 |
| **Referral** | "Talk to my colleague [X]" or "Reach out to [Y] instead" | Stop sequence on this contact + create new contact for referee + notify rep |
| **Objection** | Specific concern (timing, budget, current vendor, priority) | Stop sequence + AI drafts response addressing the objection + human review |
| **Soft no** | "Not now", "maybe later", "circle back in Q[N]" | Stop sequence + schedule re-engagement for the referenced timeframe |
| **Hard no** | "Not interested", "remove me", "stop emailing" | Stop sequence + mark `sequence_status = Opted Out` + add to global opt-out list |
| **Out of office** | Auto-reply about absence | Pause sequence + resume after the OOO end date |
| **Unsubscribe** | Click of unsubscribe link OR explicit opt-out language | Mark `sequence_status = Opted Out` + global opt-out + never re-enroll |
| **Bounce** | Hard bounce / invalid mailbox | Mark `sequence_status = Bounced` + flag email as invalid + remove from sequence |

## Hard rules

- **Hard no, unsubscribe, opt-out → permanent.** Mark global opt-out flag. Never re-engage on any channel, in any campaign, ever.
- **Stop the sequence on any reply.** Even ambiguous replies pause until classification + human/agent review.
- **Never auto-send a response.** AI drafts; a human or another operation explicitly approves before sending.
- **Speed matters for positive interest.** Notify the rep within 5 minutes of classification, not at the next batch run.
- **Track every reply in the `conversations` collection.** Append the classification to the conversation record's `summary` and `action_items` fields.

## Workspace updates

For every reply processed, append to `workspace.updates`:

```json
{
  "author": "analyze.reply-sentiment",
  "type": "engagement",
  "summary": "Reply classified as <class>",
  "details": { "class": "...", "confidence": 0.92, "conversation_id": "..." },
  "timestamp": "..."
}
```

## Edge cases

- **Multi-class reply** ("interested but timing is bad"): pick the dominant class — usually `Soft no` if timing is the blocker — and note both signals in the conversation summary.
- **Forwarded reply** (the contact CCs a colleague): treat as a referral; engage the new contact only after they reply directly.
- **Adversarial reply** (rude, hostile, threatening): mark hard no, opt out, do not engage further. No exceptions.
- **Vendor pitch reply** (someone replying with their own pitch): mark hard no, opt out from outbound, but flag for sales-team review (sometimes these are accidental partnership opportunities).
