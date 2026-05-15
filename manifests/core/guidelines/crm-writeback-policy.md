---
name: crm-writeback-policy
tags: [crm, writeback, safety]
---

CRM writes must go through the approved operation runner and passthrough path. Default to dry-run. Do not overwrite human-entered values unless the mapping explicitly allows it. Low-confidence AI values require review or must be written to dedicated Personize AI custom properties.
