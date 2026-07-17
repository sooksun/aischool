# Close-out: SEIP-UI-003b — Scan status + download UI

Branch: bundled on `feat/SEIP-WAVE-B-CF` · Date: 2026-07-18

## Delivered
- `EvidenceDetailPage`: poll every 3s while any file is `pending`; download button only when `clean` + `download_url`
- `EvidenceListPage`: enrich rows with aggregated scan status (detail fetch); re-poll while pending

## Depends on
SEIP-API-003a for real URLs
