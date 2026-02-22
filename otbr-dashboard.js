class OTBRCoreDashboard extends HTMLElement {
  static getStubConfig() {
    return {
      title: "OTBR Thread Network",
      refresh_interval: 5,
      diagnostics_paths: [
        "http://core-openthread-border-router:8081/diagnostics",
        `${window.location.protocol}//${window.location.hostname}:8081/diagnostics`,
        "/diagnostics",
      ],
      max_log_entries: 300,
      debug: true,
    };
  }

  setConfig(config) {
    this._config = {
      ...OTBRCoreDashboard.getStubConfig(),
      ...config,
    };

    if (!this.content) {
      this.attachShadow({ mode: "open" });
      this._renderShell();
    }

    this._debug(`Config loaded`, this._config);
    this._startPolling();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;

    this._entityMap = this._extractThreadEntities(hass.states || {});
    this._paint();
  }

  disconnectedCallback() {
    this._stopPolling();
  }

  _renderShell() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
          color: var(--primary-text-color);
        }

        ha-card {
          padding: 16px;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          gap: 12px;
        }

        .status {
          font-size: 12px;
          opacity: 0.85;
          text-align: right;
        }

        .grid {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 12px;
        }

        .panel {
          border: 1px solid var(--divider-color);
          border-radius: 10px;
          padding: 12px;
          background: rgba(125,125,125,0.05);
          min-height: 250px;
        }

        .panel h3 {
          margin: 0 0 8px;
          font-size: 14px;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          opacity: .8;
        }

        .network-wrap {
          position: relative;
          min-height: 380px;
          overflow: hidden;
        }

        svg {
          width: 100%;
          height: 380px;
          background: radial-gradient(circle at 20% 20%, rgba(0, 200, 255, 0.12), transparent 60%),
                      radial-gradient(circle at 80% 80%, rgba(150, 70, 255, 0.10), transparent 45%);
          border-radius: 8px;
        }

        .legend {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          font-size: 12px;
          margin-top: 8px;
        }

        .legend span::before {
          content: "";
          width: 10px;
          height: 10px;
          display: inline-block;
          border-radius: 999px;
          margin-right: 6px;
          vertical-align: -1px;
        }

        .leader::before { background: #34d399; }
        .router::before { background: #60a5fa; }
        .child::before { background: #fbbf24; }
        .offline::before { background: #f87171; }

        .lists {
          display: grid;
          gap: 10px;
        }

        .list {
          max-height: 180px;
          overflow: auto;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          font-size: 12px;
        }

        .list table {
          width: 100%;
          border-collapse: collapse;
        }

        .list th,
        .list td {
          padding: 6px;
          border-bottom: 1px solid rgba(127,127,127,0.2);
          text-align: left;
          font-family: monospace;
        }

        .logs {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          white-space: pre-wrap;
          font-size: 12px;
          max-height: 200px;
          overflow: auto;
        }

        .debug {
          margin-top: 12px;
          border-top: 1px dashed var(--divider-color);
          padding-top: 12px;
        }

        .debug summary {
          cursor: pointer;
          font-weight: 600;
        }

        .debug pre {
          max-height: 300px;
          overflow: auto;
          font-size: 11px;
          background: rgba(127,127,127,0.08);
          border-radius: 8px;
          padding: 8px;
        }

        @media (max-width: 1000px) {
          .grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
      <ha-card>
        <div class="header">
          <div>
            <h2 style="margin:0; font-size:20px;">${this._config?.title || "OTBR Dashboard"}</h2>
            <div id="endpoint"></div>
          </div>
          <div id="status" class="status"></div>
        </div>

        <div class="grid">
          <div class="panel network-wrap">
            <h3>Interactive Thread Topology</h3>
            <svg id="topology" viewBox="0 0 900 380"></svg>
            <div class="legend">
              <span class="leader">Leader</span>
              <span class="router">Router</span>
              <span class="child">Child</span>
              <span class="offline">Offline</span>
            </div>
          </div>

          <div class="panel lists">
            <div>
              <h3>Children / Signals</h3>
              <div id="children" class="list"></div>
            </div>
            <div>
              <h3>Thread Entities</h3>
              <div id="entities" class="list"></div>
            </div>
            <div>
              <h3>Live Event Log</h3>
              <div id="logs" class="logs"></div>
            </div>
          </div>
        </div>

        <details class="debug" ${this._config?.debug ? "open" : ""}>
          <summary>Debug / Raw Diagnostics</summary>
          <pre id="debug"></pre>
        </details>
      </ha-card>
    `;

    this.content = true;
  }

  _startPolling() {
    this._stopPolling();
    this._poll();
    const ms = Math.max(2, Number(this._config.refresh_interval || 5)) * 1000;
    this._timer = setInterval(() => this._poll(), ms);
  }

  _stopPolling() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _debug(msg, data) {
    if (!this._config?.debug) return;
    console.debug(`[otbr-dashboard] ${msg}`, data ?? "");
  }

  _appendLog(type, message, payload) {
    const now = new Date().toISOString();
    this._logs = this._logs || [];
    this._logs.unshift({ now, type, message, payload });
    this._logs = this._logs.slice(0, Number(this._config.max_log_entries || 300));
  }

  async _poll() {
    const result = await this._fetchDiagnostics();
    this._lastPoll = new Date();

    if (!result?.ok) {
      this._appendLog("error", `Diagnostics fetch failed`, result?.error || "unknown");
      this._paint();
      return;
    }

    this._activeEndpoint = result.endpoint;
    this._raw = result.data;
    this._topology = this._parseTopology(result.data);

    this._detectChanges();
    this._paint();
  }

  async _fetchDiagnostics() {
    const endpoints = this._config.diagnostics_paths || [];
    const token = this._hass?.auth?.data?.access_token;

    for (const endpoint of endpoints) {
      try {
        const headers = {
          Accept: "application/json, text/plain, */*",
        };

        if (token) headers.Authorization = `Bearer ${token}`;

        this._debug(`Trying endpoint: ${endpoint}`);
        const res = await fetch(endpoint, {
          method: "GET",
          headers,
          mode: "cors",
          credentials: "include",
          cache: "no-store",
        });

        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} @ ${endpoint}: ${text?.slice(0, 500)}`);
        }

        this._debug(`Endpoint ok: ${endpoint}`, data);
        return { ok: true, endpoint, data };
      } catch (error) {
        this._debug(`Endpoint failed: ${endpoint}`, error);
        this._appendLog("warn", `Fetch failed for ${endpoint}`, String(error));
      }
    }

    return { ok: false, error: "No diagnostics endpoint responded." };
  }

  _parseTopology(data) {
    const source = data?.topology || data?.thread_network || data || {};
    const leaderId = source.leader_id || source.leader || source.rloc16;

    const routers = source.routers || source.router_table || [];
    const children = source.children || source.child_table || [];

    const nodes = [];
    const links = [];

    const normalizeNode = (raw, roleHint) => {
      const id = String(
        raw.id || raw.ext_address || raw.eui64 || raw.rloc16 || raw.rloc || raw.address || raw.name || Math.random()
      );
      const role = (raw.role || roleHint || "child").toLowerCase();
      const signal = Number(raw.rssi ?? raw.signal ?? raw.avg_rssi ?? raw.link_quality ?? NaN);
      const online = raw.online ?? raw.is_online ?? raw.state !== "offline";
      return {
        id,
        label: raw.name || raw.hostname || raw.device || id.slice(0, 12),
        role,
        parent: raw.parent || raw.parent_id || raw.parent_rloc || null,
        signal: Number.isFinite(signal) ? signal : null,
        status: raw.state || (online ? "online" : "offline"),
        raw,
      };
    };

    for (const router of routers) nodes.push(normalizeNode(router, "router"));
    for (const child of children) nodes.push(normalizeNode(child, "child"));

    if (!nodes.length && Array.isArray(source.nodes)) {
      for (const n of source.nodes) nodes.push(normalizeNode(n, n.role));
    }

    if (!nodes.length && source.node) {
      nodes.push(normalizeNode(source.node, source.node.role || "leader"));
    }

    nodes.forEach((n) => {
      if (n.id === String(leaderId)) n.role = "leader";
      if (n.parent) links.push({ source: String(n.parent), target: n.id });
    });

    return { nodes, links, leaderId: leaderId ? String(leaderId) : null };
  }

  _extractThreadEntities(states) {
    const map = [];
    for (const [entityId, state] of Object.entries(states)) {
      const attrs = state.attributes || {};
      const joined = JSON.stringify(attrs).toLowerCase();
      if (
        entityId.includes("thread") ||
        joined.includes("thread") ||
        joined.includes("eui64") ||
        joined.includes("rloc") ||
        joined.includes("openthread")
      ) {
        map.push({
          entityId,
          name: attrs.friendly_name || entityId,
          state: state.state,
          attrs,
          key: String(attrs.eui64 || attrs.ext_address || attrs.mac || attrs.rloc16 || entityId).toLowerCase(),
        });
      }
    }
    return map;
  }

  _detectChanges() {
    const prev = this._previousTopology || { nodes: [] };
    const prevById = new Map(prev.nodes.map((n) => [n.id, n]));

    for (const node of this._topology.nodes) {
      const old = prevById.get(node.id);
      if (!old) {
        this._appendLog("node", `Node joined: ${node.label} (${node.id})`, node);
      } else {
        if (node.status !== old.status) {
          this._appendLog("status", `Status changed: ${node.label} ${old.status} -> ${node.status}`, node);
        }
        if (node.signal !== old.signal && node.signal !== null) {
          this._appendLog("signal", `Signal update: ${node.label} ${old.signal} -> ${node.signal}`, node);
        }
      }
    }

    const currentIds = new Set(this._topology.nodes.map((n) => n.id));
    for (const oldNode of prev.nodes) {
      if (!currentIds.has(oldNode.id)) {
        this._appendLog("node", `Node left: ${oldNode.label} (${oldNode.id})`, oldNode);
      }
    }

    this._previousTopology = JSON.parse(JSON.stringify(this._topology));
  }

  _paint() {
    if (!this.shadowRoot) return;
    const status = this.shadowRoot.getElementById("status");
    const endpoint = this.shadowRoot.getElementById("endpoint");
    const children = this.shadowRoot.getElementById("children");
    const entities = this.shadowRoot.getElementById("entities");
    const logs = this.shadowRoot.getElementById("logs");
    const debug = this.shadowRoot.getElementById("debug");

    status.textContent = this._lastPoll
      ? `Last update: ${this._lastPoll.toLocaleTimeString()} | Nodes: ${this._topology?.nodes?.length || 0}`
      : "Waiting for first diagnostics poll...";

    endpoint.textContent = `Endpoint: ${this._activeEndpoint || "unreachable"}`;

    this._renderTopologySvg(this.shadowRoot.getElementById("topology"), this._topology || { nodes: [], links: [] });

    const childRows = (this._topology?.nodes || [])
      .filter((n) => n.role === "child" || n.role === "router" || n.role === "leader")
      .sort((a, b) => (b.signal ?? -999) - (a.signal ?? -999))
      .map(
        (n) => `<tr>
            <td>${n.label}</td>
            <td>${n.role}</td>
            <td>${n.signal ?? "n/a"}</td>
            <td>${n.status}</td>
          </tr>`
      )
      .join("");

    children.innerHTML = `<table>
      <thead><tr><th>Node</th><th>Role</th><th>Signal</th><th>Status</th></tr></thead>
      <tbody>${childRows || `<tr><td colspan="4">No node data yet.</td></tr>`}</tbody>
    </table>`;

    const entityRows = (this._entityMap || [])
      .map(
        (e) => `<tr>
          <td>${e.name}</td>
          <td>${e.entityId}</td>
          <td>${e.state}</td>
        </tr>`
      )
      .join("");

    entities.innerHTML = `<table>
      <thead><tr><th>Name</th><th>Entity</th><th>State</th></tr></thead>
      <tbody>${entityRows || `<tr><td colspan="3">No thread entities found.</td></tr>`}</tbody>
    </table>`;

    logs.textContent = (this._logs || [])
      .map((l) => `[${l.now}] [${l.type}] ${l.message}${l.payload ? `\n${JSON.stringify(l.payload, null, 2)}` : ""}`)
      .join("\n\n");

    debug.textContent = JSON.stringify(
      {
        activeEndpoint: this._activeEndpoint,
        topology: this._topology,
        entityCount: this._entityMap?.length || 0,
        logs: this._logs?.slice(0, 20) || [],
        rawDiagnostics: this._raw,
      },
      null,
      2
    );
  }

  _renderTopologySvg(svg, topology) {
    if (!svg) return;
    const nodes = topology.nodes || [];
    const links = topology.links || [];

    const width = 900;
    const height = 380;

    const withPos = nodes.map((n, i) => {
      const angle = (Math.PI * 2 * i) / Math.max(1, nodes.length);
      const radius = n.role === "child" ? 130 : 90;
      return {
        ...n,
        x: width / 2 + Math.cos(angle) * radius + (n.role === "leader" ? 0 : (i % 3) * 18),
        y: height / 2 + Math.sin(angle) * radius + (n.role === "leader" ? 0 : ((i + 1) % 3) * 14),
      };
    });

    const posById = new Map(withPos.map((n) => [n.id, n]));

    const lineSvg = links
      .map((l) => {
        const a = posById.get(String(l.source));
        const b = posById.get(String(l.target));
        if (!a || !b) return "";
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="rgba(148, 163, 184, 0.7)" stroke-width="1.5"/>`;
      })
      .join("");

    const nodeSvg = withPos
      .map((n) => {
        const color =
          n.status === "offline"
            ? "#f87171"
            : n.role === "leader"
              ? "#34d399"
              : n.role === "router"
                ? "#60a5fa"
                : "#fbbf24";

        return `<g class="node" data-id="${n.id}" style="cursor:pointer;">
          <circle cx="${n.x}" cy="${n.y}" r="${n.role === "leader" ? 18 : 13}" fill="${color}" fill-opacity="0.95"/>
          <text x="${n.x}" y="${n.y - 20}" text-anchor="middle" font-size="11" fill="currentColor">${n.label}</text>
          <text x="${n.x}" y="${n.y + 3}" text-anchor="middle" font-size="9" fill="#0f172a">${n.signal ?? "n/a"}</text>
        </g>`;
      })
      .join("");

    svg.innerHTML = `${lineSvg}${nodeSvg}`;

    svg.querySelectorAll("g.node").forEach((g) => {
      g.addEventListener("click", () => {
        const id = g.getAttribute("data-id");
        const node = withPos.find((n) => n.id === id);
        if (!node) return;
        this._appendLog("inspect", `Node inspected: ${node.label}`, node);
        this._paint();
      });
    });
  }

  getCardSize() {
    return 8;
  }
}

customElements.define("otbr-lovelace-dashboard", OTBRCoreDashboard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "otbr-lovelace-dashboard",
  name: "OTBR Core OpenThread Dashboard",
  description: "Interactive diagnostics dashboard for core-openthread-border-router /diagnostics",
  preview: true,
});
