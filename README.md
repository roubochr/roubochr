# OTBR Lovelace Dashboard

Custom Lovelace JS card for Home Assistant that visualizes the OpenThread network from `core-openthread-border-router` diagnostics.

## Features

- Interactive topology graph with clickable nodes.
- Live node status and signal updates.
- Child/router tables and Thread-related entity discovery from HA state.
- In-card event log for joins, leaves, status changes, and signal deltas.
- Full debug pane with raw diagnostics payload and endpoint trace.
- Multi-endpoint diagnostics fallback for:
  - `http://core-openthread-border-router:8081/diagnostics`
  - `http(s)://<current-host>:8081/diagnostics`
  - `/diagnostics` (for reverse-proxy paths like `home.croubos.com`)

## Install

1. Copy `otbr-dashboard.js` to your Home Assistant `/config/www/` directory.
2. Add resource:
   - **Settings → Dashboards → Resources**
   - URL: `/local/otbr-dashboard.js`
   - Type: `JavaScript module`
3. Add card manually in dashboard YAML:

```yaml
type: custom:otbr-lovelace-dashboard
title: OTBR Thread Network
refresh_interval: 5
debug: true
max_log_entries: 500
diagnostics_paths:
  - http://core-openthread-border-router:8081/diagnostics
  - https://home.croubos.com/diagnostics
  - /diagnostics
```

## Proxy notes

To support both local and `home.croubos.com` access, ensure your proxy forwards `/diagnostics` to `core-openthread-border-router:8081/diagnostics` and does not strip auth headers/cookies when required.

## Debugging

- Set `debug: true` to keep console and on-card debug output active.
- Card sends `Authorization: Bearer <HA token>` when available from `hass.auth.data.access_token`.
- Endpoint failures are logged in **Live Event Log** and browser devtools (`[otbr-dashboard]`).
