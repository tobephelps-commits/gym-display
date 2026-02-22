# Phase 2: User Setup Required

**Generated:** 2026-02-22
**Phase:** 02-wod-display
**Status:** Incomplete

## Dashboard Configuration

- [ ] **Add real WodScreen credentials to config.yaml**
  - Location: `config.yaml` -> `wodscreen` section
  - Details: Replace `your_username` / `your_password` with actual Beyond the Whiteboard (BTWB) credentials

## Verification

After updating credentials:

```bash
# Start the server
npm start

# Check WodScraper status (should show "ready" after login completes)
curl http://localhost:3000/api/wod/status

# Check screenshot is available (should return image/jpeg)
curl -I http://localhost:3000/api/wod/screenshot
```

Expected: `/api/wod/status` returns `{"status":"ready","wodPageUrl":"...","lastScreenshotTime":"...","cookieCount":N}`

---
**Once all items complete:** Mark status as "Complete"
