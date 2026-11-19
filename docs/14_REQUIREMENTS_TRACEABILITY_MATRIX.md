# 14 — Requirements Traceability Matrix

| Requirement | Source | Design (doc) | Milestone | Test | Evidence artefact | Status |
|---|---|---|---|---|---|---|
| HR-001 mainnet | rules | 11 §4 | M2 | TEST-D01 | deployment.json | BLOCKED (until M2) |
| HR-002 repo | rules | 11 §6 | M6 | checklist | repo URL | BLOCKED |
| HR-003 live URL | rules | 05 §7 | M5 | TEST-E01 | URL | BLOCKED |
| HR-007/008 originality | rules | 01 PR-1/2 | all | — | commit log | REQUIRES EXECUTION |
| FR-001 | 03 | 06 | M1 | TEST-C01 | test log | REQUIRES EXECUTION TEST |
| FR-002 / SEC-001 | 03 | 06 | M1 | TEST-C02 | test log | REQUIRES EXECUTION TEST |
| FR-003 | 03 | 06 | M1 | TEST-C03 | test log | REQUIRES EXECUTION TEST |
| FR-004 | 03 | 06 | M1/M2 | TEST-C04 | tx | single-account VERIFIED; multi REQUIRES EXECUTION |
| FR-005 / SEC-002/006 | 03 | 06 | M1 | TEST-C05, C06 | test log | per-call VERIFIED (old contract) |
| FR-006 / SEC-005 | 03 | 06 | M1 | TEST-C07 | tx | VERIFIED (old contract) |
| FR-007 | 03 | 06 | M1 | TEST-C08 | test log | REQUIRES EXECUTION TEST |
| FR-008 / SEC-007 | 03 | 06 | M1 | TEST-C09 | test log | REQUIRES EXECUTION TEST |
| FR-009 / SEC-004 | 03 | 06 | M1 | TEST-C10 | test log | REQUIRES EXECUTION TEST |
| FR-010 | 03 | 06 | M1 | TEST-C11 | test log | REQUIRES EXECUTION TEST |
| FR-023 | 03 | 11 | M2 | TEST-D01 | explorer link | BLOCKED |
| FR-011 | 03 | 05 §4, 06 §4 | M3 | TEST-M01 | test log | REQUIRES EXECUTION TEST |
| FR-012 / SEC-011 | 03 | 05 §3 | M3 | TEST-M02..M06 | test log | REQUIRES EXECUTION TEST |
| FR-013 | 03 | 05 §5, 06 §3 | M3 | TEST-M07 | test log | REQUIRES EXECUTION TEST |
| FR-014 | 03 | 05 §5 | M3 | TEST-M08, M09 | test log | REQUIRES EXECUTION TEST |
| FR-015 / NFR-001 | 03 | 07 | M3 | TEST-M10 | test log | receipt delay VERIFIED; behaviour untested |
| FR-016 | 03 | 04 | M3 | TEST-M11 | sample app | REQUIRES EXECUTION TEST |
| FR-017 | 03 | 03 | M4 | TEST-E01 | demo | REQUIRES EXECUTION TEST |
| FR-018 | 03 | 05 §6 | M4 (cuttable) | TEST-M13 | test log | BLOCKED (feed unverified) |
| FR-019..FR-022 | 03 | 07, 12 | M4–M5 | TEST-E01 | demo, URL | REQUIRES EXECUTION TEST |
| NFR-003 | 03 | 05 | M3 | TEST-M12 | test log | rpc2 ASSUMED |
| SEC-003, 008, 009, 012–014 | 06 | 06, 08 | M1/M3 | TEST-C07, C12, C13, M12, X02 | logs | REQUIRES EXECUTION TEST |
| SEC-010 | 06 | 08 | M0 | TEST-S02 | CI log | REQUIRES EXECUTION TEST |
| INT-001..INT-006 | 04 | 04 | M2–M5 | TEST-D01, E01, X01 | logs | INT-001/002 VERIFIED; INT-004/005 ASSUMED/BLOCKED |
| DATA-001..DATA-012 | 06 | 06 | M1/M3 | TEST-C*, TEST-M07 | logs | — |
| DG-1 | amendment 2 | 02 §5 | M0 | decision record | DIFFERENTIATION.md | REQUIRES EXECUTION |
| RD-1 | amendment 6 | 09 §2 | M1 | RD record | CHANGELOG | REQUIRES EXECUTION |
