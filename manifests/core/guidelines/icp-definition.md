---
name: icp-definition
tags: [icp, ideal-customer, qualification, scoring, target, fit]
---

# ICP Definition

> **Customize this template for your business.** This is the rule every scoring,
> targeting, and outreach operation reads. Replace the brackets and adjust
> ranges to match your reality.

## Company Criteria

- Industry: [your target verticals — e.g. B2B SaaS, Fintech, Healthcare]
- Employee count: [low]-[high]
- Annual revenue: [low]-[high]
- Growth stage: [Series A, Series B+, profitable, scaling, etc.]
- Tech stack: [must use HubSpot or Salesforce, must have a sales team of N+, etc.]

## Contact Criteria

- Title: [list of target titles]
- Seniority: [IC / Manager / Director / VP / C-Suite]
- Department: [Sales / Marketing / Revenue / Operations / etc.]

## Disqualification Criteria

- [Specific firmographic disqualifiers, e.g. "Companies <20 employees"]
- [Existing customer overlap, e.g. "Already using [your product]"]
- [Industries you don't serve, e.g. "Government, non-profit"]
- [Behavioral disqualifiers, e.g. "No sales team", "No outbound motion"]

## Scoring Weights

When `score.icp-fit` runs, use these weights:

- ICP fit (firmographics): 40%
- Buying signals (timing): 30%
- Engagement signals (behavior): 20%
- Champion potential (title + seniority): 10%

Adjust weights to match your sales motion. Inbound-led teams tend to upweight
engagement; outbound-led teams upweight ICP fit.
